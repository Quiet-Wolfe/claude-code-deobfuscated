"""FlyLM: a language model whose sequence mixer is the Drosophila mushroom body.

There is no attention anywhere. Every layer is a mushroom body built from the
male CNS connectome (v1.0):

    x ─► short causal conv (PN temporal filtering)
      ─► per lobe (gamma, alpha/beta, alpha'/beta'):
           query / key PN drive (58 glomeruli)
           ─► the lobe's real PN->KC synapse matrix (fixed)       662 / 874 / 350 KCs
           ─► APL: k-winners-take-all, 5% of KCs active
           value = 49 MBON targets
           170 DANs ─► connectome DAN->MBON compartments ─► plasticity gate per MBON
           fast KC->MBON synapses:  W_t = W_{t-1} + g_t * (v_t - W_{t-1} k_t) k_t^T
           read:                    r_t = W_t q_t
      ─► concat lobes ─► output projection
    then a SwiGLU MLP.

The fast synapses are the model's only memory of the context. They are rewritten
by the dopamine-gated delta rule while the model reads; nothing is stored as a
KV cache. At inference the model is an RNN with constant memory per token, and
the synaptic `state` can be handed back in to keep learning across calls.
"""

from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import GenerationMixin, PreTrainedModel
from transformers.utils import ModelOutput

try:
    from .configuration_flylm import FlyLMConfig
except ImportError:  # loaded as a plain module
    from configuration_flylm import FlyLMConfig

LOBES = ("gamma", "alpha_beta", "alphap_betap")


@dataclass
class FlyLMOutput(ModelOutput):
    loss: torch.FloatTensor | None = None
    logits: torch.FloatTensor | None = None
    state: list | None = None
    hidden_states: tuple | None = None


class RMSNorm(nn.Module):
    def __init__(self, d, eps=1e-6):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(d))
        self.eps = eps

    def forward(self, x):
        return self.weight * x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps)


def kwta(z, k):
    """APL global inhibition: keep the k most strongly driven Kenyon cells."""
    thr = z.topk(k, dim=-1).values[..., -1:]
    return z * (z >= thr)


def delta_rule(Q, K, V, G, W, chunk):
    """Exact chunk-parallel gated delta rule.

    Q, K: (B,T,N) unit-norm KC codes; V, G: (B,T,M); W: (B,M,N) fast synapses.
    W_t = W_{t-1} + g_t * (v_t - W_{t-1} k_t) k_t^T,   out_t = W_t q_t.
    Within a chunk the write recurrence is a unit-lower-triangular system per MBON.
    """
    outs = []
    for q, k, v, g in zip(Q.split(chunk, 1), K.split(chunk, 1), V.split(chunk, 1), G.split(chunk, 1)):
        L = k.shape[1]
        Wt = W.transpose(1, 2)                                       # (B,N,M)
        kk = k @ k.transpose(1, 2)                                   # (B,L,L)
        # the triangular solve and the synaptic state stay in fp32 even under autocast
        A = torch.eye(L, device=k.device) + g.float().transpose(1, 2)[..., None] * torch.tril(kk.float(), -1)[:, None]
        rhs = (g.float() * (v.float() - (k @ Wt).float())).transpose(1, 2)[..., None]   # (B,M,L,1)
        U = torch.linalg.solve_triangular(A, rhs, upper=False, unitriangular=True)[..., 0].transpose(1, 2)
        outs.append((q @ Wt).float() + torch.tril(q @ k.transpose(1, 2)).float() @ U)
        W = W + (U.transpose(1, 2) @ k.float())
    return torch.cat(outs, 1), W


class MushroomBodyLayer(nn.Module):
    def __init__(self, config: FlyLMConfig):
        super().__init__()
        d, G, M, D = config.hidden_size, config.n_glomeruli, config.n_mbon, config.n_dan
        self.chunk = config.chunk_size
        self.K = config.conv_kernel
        self.conv = nn.Conv1d(d, d, self.K, groups=d)
        self.q_pn = nn.ModuleDict({l: nn.Linear(d, G) for l in LOBES})
        self.k_pn = nn.ModuleDict({l: nn.Linear(d, G) for l in LOBES})
        self.v = nn.ModuleDict({l: nn.Linear(d, M) for l in LOBES})
        self.dan = nn.ModuleDict({l: nn.Linear(d, D) for l in LOBES})
        self.dan_bias = nn.ParameterDict({l: nn.Parameter(torch.full((M,), -1.0)) for l in LOBES})
        self.out_norm = nn.ModuleDict({l: RMSNorm(M, config.rms_norm_eps) for l in LOBES})
        self.o = nn.Linear(3 * M, d, bias=False)
        self.n_kc, self.k_active = {}, {}
        for l in LOBES:
            n = config.mb_lobe_sizes[l]
            W = torch.zeros(G, n)
            for gi, ki, w in config.mb_lobes[l]:
                W[gi, ki] = w
            self.register_buffer(f"pn_kc_{l}", W)                    # fixed connectome wiring
            self.n_kc[l] = n
            self.k_active[l] = max(1, round(config.kc_sparsity * n))
        self.register_buffer("dan_mbon", torch.tensor(config.mb_dan_mbon, dtype=torch.float32))

    def kc(self, pn_drive, lobe):
        z = F.relu(pn_drive) @ getattr(self, f"pn_kc_{lobe}")
        return F.normalize(kwta(z, self.k_active[lobe]), dim=-1, eps=1e-6)

    def forward(self, x, state=None):
        B, T, d = x.shape
        conv_state = state["conv"] if state is not None else x.new_zeros(B, self.K - 1, d)
        xp = torch.cat([conv_state, x], 1)
        xc = F.silu(self.conv(xp.transpose(1, 2)).transpose(1, 2))
        new_state = {"conv": xp[:, -(self.K - 1):].detach() if not self.training else xp[:, -(self.K - 1):]}
        reads = []
        for l in LOBES:
            q = self.kc(self.q_pn[l](xc), l)
            k = self.kc(self.k_pn[l](xc), l)
            v = self.v[l](xc)
            g = torch.sigmoid(4 * F.relu(self.dan[l](x)) @ self.dan_mbon + self.dan_bias[l])
            W0 = state[l] if state is not None else x.new_zeros(B, v.shape[-1], self.n_kc[l])
            r, W = delta_rule(q, k, v, g, W0, self.chunk)
            reads.append(self.out_norm[l](r))
            new_state[l] = W
        return self.o(torch.cat(reads, -1)), new_state


class SwiGLU(nn.Module):
    def __init__(self, d, h):
        super().__init__()
        self.gate = nn.Linear(d, h, bias=False)
        self.up = nn.Linear(d, h, bias=False)
        self.down = nn.Linear(h, d, bias=False)

    def forward(self, x):
        return self.down(F.silu(self.gate(x)) * self.up(x))


class FlyLMBlock(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.norm1 = RMSNorm(config.hidden_size, config.rms_norm_eps)
        self.mb = MushroomBodyLayer(config)
        self.norm2 = RMSNorm(config.hidden_size, config.rms_norm_eps)
        self.mlp = SwiGLU(config.hidden_size, config.intermediate_size)

    def forward(self, x, state=None):
        h, s = self.mb(self.norm1(x), state)
        x = x + h
        return x + self.mlp(self.norm2(x)), s


class FlyLMPreTrainedModel(PreTrainedModel):
    config_class = FlyLMConfig
    base_model_prefix = "model"
    _is_stateful = True
    _no_split_modules = ["FlyLMBlock"]

    @classmethod
    def _supports_default_dynamic_cache(cls):
        return False                       # the cache is the synaptic `state`, not KV pairs

    def _init_weights(self, module):
        std = self.config.initializer_range
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=std)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=std)


class FlyLMModel(FlyLMPreTrainedModel):
    def __init__(self, config):
        super().__init__(config)
        self.embed_tokens = nn.Embedding(config.vocab_size, config.hidden_size)
        self.layers = nn.ModuleList(FlyLMBlock(config) for _ in range(config.num_hidden_layers))
        self.norm = RMSNorm(config.hidden_size, config.rms_norm_eps)
        self.post_init()

    def get_input_embeddings(self):
        return self.embed_tokens

    def set_input_embeddings(self, value):
        self.embed_tokens = value

    def forward(self, input_ids, state=None, output_hidden_states=False):
        x = self.embed_tokens(input_ids)
        new_state, hs = [], []
        i = 0
        for _ in range(self.config.num_loops):          # weight-tied recurrent depth
            for layer in self.layers:
                x, s = layer(x, state[i] if state is not None else None)
                new_state.append(s)
                if output_hidden_states:
                    hs.append(x)
                i += 1
        return self.norm(x), new_state, (tuple(hs) if output_hidden_states else None)


class FlyLMForCausalLM(FlyLMPreTrainedModel, GenerationMixin):
    _tied_weights_keys = {"lm_head.weight": "model.embed_tokens.weight"}

    def __init__(self, config):
        super().__init__(config)
        self.model = FlyLMModel(config)
        self.lm_head = nn.Linear(config.hidden_size, config.vocab_size, bias=False)
        self.post_init()

    def get_input_embeddings(self):
        return self.model.embed_tokens

    def set_input_embeddings(self, value):
        self.model.embed_tokens = value

    def get_output_embeddings(self):
        return self.lm_head

    def set_output_embeddings(self, value):
        self.lm_head = value

    def prepare_inputs_for_generation(self, input_ids, state=None, use_cache=None, **kwargs):
        if state is not None:
            input_ids = input_ids[:, -1:]           # the synapses already hold the prefix
        return {"input_ids": input_ids, "state": state, "use_cache": use_cache}

    def forward(self, input_ids=None, state=None, labels=None, use_cache=None,
                output_hidden_states=False, return_dict=True, logits_to_keep=0, **kwargs):
        h, new_state, hs = self.model(input_ids, state, output_hidden_states)
        if logits_to_keep:
            h = h[:, -logits_to_keep:]
        logits = self.lm_head(h)
        loss = None
        if labels is not None:
            loss = F.cross_entropy(logits[:, :-1].reshape(-1, logits.shape[-1]).float(),
                                   labels[:, 1:].reshape(-1), ignore_index=-100)
        if use_cache is False:
            new_state = None
        return FlyLMOutput(loss=loss, logits=logits, state=new_state, hidden_states=hs)


FlyLMConfig.register_for_auto_class()
FlyLMForCausalLM.register_for_auto_class("AutoModelForCausalLM")
