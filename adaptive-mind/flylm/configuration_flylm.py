"""FlyLM configuration.

The mushroom-body wiring (PN->KC synapses per lobe and the DAN->MBON compartment
matrix, measured in the Drosophila male CNS connectome v1.0) is stored inside the
config, so a model can be built from the config alone.
"""

from transformers import PretrainedConfig


class FlyLMConfig(PretrainedConfig):
    model_type = "flylm"

    def __init__(
        self,
        vocab_size=4096,
        hidden_size=192,
        num_hidden_layers=4,
        num_loops=1,
        intermediate_size=512,
        conv_kernel=4,
        kc_sparsity=0.05,
        n_mbon=49,
        n_dan=170,
        n_glomeruli=58,
        chunk_size=32,
        rms_norm_eps=1e-6,
        initializer_range=0.02,
        tie_word_embeddings=True,
        mb_lobes=None,          # {"gamma": [[glom, kc, w], ...], "alpha_beta": ..., "alphap_betap": ...}
        mb_lobe_sizes=None,     # {"gamma": 662, ...}
        mb_dan_mbon=None,       # n_dan x n_mbon, non-negative, column-normalised
        bos_token_id=None,
        eos_token_id=0,
        pad_token_id=0,
        **kwargs,
    ):
        self.vocab_size = vocab_size
        self.hidden_size = hidden_size
        self.num_hidden_layers = num_hidden_layers
        self.num_loops = num_loops
        self.intermediate_size = intermediate_size
        self.conv_kernel = conv_kernel
        self.kc_sparsity = kc_sparsity
        self.n_mbon = n_mbon
        self.n_dan = n_dan
        self.n_glomeruli = n_glomeruli
        self.chunk_size = chunk_size
        self.rms_norm_eps = rms_norm_eps
        self.initializer_range = initializer_range
        self.mb_lobes = mb_lobes
        self.mb_lobe_sizes = mb_lobe_sizes
        self.mb_dan_mbon = mb_dan_mbon
        super().__init__(
            bos_token_id=bos_token_id,
            eos_token_id=eos_token_id,
            pad_token_id=pad_token_id,
            tie_word_embeddings=tie_word_embeddings,
            **kwargs,
        )


def connectome_fields(npz_path):
    """Reads adaptive-mind/data/mushroom_body_R.npz into the config fields above."""
    import numpy as np

    mb = np.load(npz_path)
    G = mb["GLOM_KC"].astype(np.float32)
    G = np.where(G >= 3, G, 0)
    types = mb["kc_type"]
    lobe_of = lambda t: ("gamma" if t.startswith("KCg") else
                         "alpha_beta" if t.startswith("KCab") else
                         "alphap_betap" if t.startswith("KCa'b'") else None)
    lobes, sizes = {}, {}
    for name in ("gamma", "alpha_beta", "alphap_betap"):
        cols = [j for j in range(G.shape[1]) if lobe_of(str(types[j])) == name and G[:, j].sum() > 0]
        sub = G[:, cols]
        sub = sub / sub.sum(0, keepdims=True)
        gi, ki = np.nonzero(sub)
        lobes[name] = [[int(a), int(b), round(float(sub[a, b]), 4)] for a, b in zip(gi, ki)]
        sizes[name] = len(cols)
    comp = np.clip(mb["COMP"].astype(np.float32), 0, None)
    comp = comp / (comp.sum(0, keepdims=True) + 1e-6)
    return dict(mb_lobes=lobes, mb_lobe_sizes=sizes,
                mb_dan_mbon=np.round(comp, 4).tolist(),
                n_dan=comp.shape[0], n_mbon=comp.shape[1], n_glomeruli=G.shape[0])
