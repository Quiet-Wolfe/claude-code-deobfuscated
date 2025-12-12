# Claude Code - Deobfuscated Version

This repository contains a deobfuscated, modular version of Claude Code. The original bundled `cli.js` (9.8MB of minified code) has been reorganized into separate, readable modules.

## Project Structure

```
claude-code-deobfuscated/
├── cli.js                    # Original bundled/minified file (preserved)
├── cli-deobfuscated.js       # New modular entry point
├── package.json              # Updated with new exports
├── src/
│   ├── index.js              # Main module exports
│   ├── constants/
│   │   └── index.js          # Application constants, version info, tool names
│   ├── utils/
│   │   ├── index.js          # Utils barrel export
│   │   ├── logger.js         # Logging with debug filtering
│   │   ├── fs-utils.js       # Filesystem operations
│   │   └── memoize.js        # Memoization, debounce, throttle
│   ├── config/
│   │   ├── index.js          # Config barrel export
│   │   └── settings.js       # Settings management (user/project/env)
│   ├── api/
│   │   └── anthropic-client.js  # Anthropic API client with streaming
│   ├── tools/
│   │   ├── index.js          # Tools barrel export & registry
│   │   ├── base-tool.js      # Base tool class & registry
│   │   ├── read-tool.js      # File reading (with images, PDFs)
│   │   ├── write-tool.js     # File writing
│   │   ├── edit-tool.js      # String replacement editing
│   │   ├── bash-tool.js      # Command execution
│   │   ├── glob-tool.js      # File pattern matching
│   │   └── grep-tool.js      # Content searching (ripgrep)
│   ├── ui/
│   │   ├── index.js          # UI barrel export
│   │   ├── colors.js         # ANSI colors & themes
│   │   └── spinner.js        # Loading spinners
│   ├── services/
│   │   └── conversation.js   # Conversation & message management
│   └── cli/
│       ├── index.js          # Main CLI logic
│       └── args.js           # Argument parsing
└── vendor/
    └── ripgrep/              # Platform-specific ripgrep binaries
```

## Usage

### Running the Deobfuscated Version

```bash
# Run with the modular code
node cli-deobfuscated.js "Your prompt here"

# Or use npm script
npm start -- "Your prompt here"

# Run the original bundled version
npm run start:original
```

### Importing Modules

```javascript
// Import everything
import ClaudeCode from './src/index.js';

// Import specific modules
import { VERSION, TOOL_NAMES } from './src/constants/index.js';
import { debug, writeStdout } from './src/utils/logger.js';
import { getSettings, updateUserSettings } from './src/config/settings.js';
import { AnthropicClient, getClient } from './src/api/anthropic-client.js';
import { globalRegistry, executeTool, ReadTool } from './src/tools/index.js';
import { colors, createSpinner } from './src/ui/index.js';
import { Conversation, Message } from './src/services/conversation.js';
```

## Key Features Explained

### Tool System (`src/tools/`)

Tools are the primary way Claude interacts with the local system. Each tool:
- Extends `BaseTool` class
- Defines an input schema (JSON Schema)
- Implements an `execute()` method
- Returns success/error results

```javascript
import { BaseTool, globalRegistry } from './src/tools/base-tool.js';

class MyCustomTool extends BaseTool {
  constructor() {
    super({
      name: "MyTool",
      description: "Does something useful",
      inputSchema: {
        type: "object",
        properties: {
          param1: { type: "string", description: "A parameter" }
        },
        required: ["param1"]
      }
    });
  }

  async execute(input, context) {
    // Your logic here
    return this.success({ result: "done" });
  }
}

// Register your tool
globalRegistry.register(new MyCustomTool());
```

### Settings System (`src/config/`)

Settings are loaded from multiple sources (in order of precedence):
1. System defaults
2. User settings (`~/.claude/settings.json`)
3. Project settings (`.claude/settings.json`)
4. Environment variables
5. Command line arguments

```javascript
import { getSettings, updateUserSettings } from './src/config/settings.js';

// Get merged settings
const settings = getSettings();

// Update user settings
updateUserSettings((current) => ({
  ...current,
  model: "claude-opus-4-5-20251101"
}));
```

### API Client (`src/api/`)

The Anthropic client supports:
- Streaming and non-streaming messages
- Tool use
- Retry with exponential backoff
- Token counting

```javascript
import { getClient } from './src/api/anthropic-client.js';

const client = getClient({ apiKey: process.env.ANTHROPIC_API_KEY });

// Streaming message
for await (const event of client.createMessageStream({
  messages: [{ role: "user", content: "Hello" }],
  maxTokens: 1024
})) {
  console.log(event);
}
```

### Conversation Management (`src/services/`)

```javascript
import { Conversation, Message, getCurrentConversation } from './src/services/conversation.js';

const convo = getCurrentConversation();
convo.addMessage(Message.user("Hello Claude"));
convo.save(); // Persists to ~/.claude/conversations/
```

## Modifying Claude Code

### Adding a New Tool

1. Create a new file in `src/tools/`:
```javascript
// src/tools/my-tool.js
import { BaseTool } from "./base-tool.js";

export class MyTool extends BaseTool {
  constructor() {
    super({
      name: "MyTool",
      description: "Description for Claude",
      inputSchema: { /* ... */ }
    });
  }

  async execute(input, context) {
    // Implementation
  }
}

export const myTool = new MyTool();
```

2. Register in `src/tools/index.js`:
```javascript
import { myTool } from "./my-tool.js";
globalRegistry.register(myTool);
```

### Adding a Slash Command

Create a command handler in `src/cli/commands/` and register it in the CLI module.

### Customizing the UI

Modify `src/ui/colors.js` to change themes or add new color schemes.

## Differences from Original

The deobfuscated version provides:
- **Readable code** - Clear variable names and comments
- **Modular structure** - Separate files for each concern
- **Type annotations** - JSDoc comments for IDE support
- **Extensibility** - Easy to add new tools and features

The original `cli.js` contains additional features not yet extracted:
- Full React/Ink interactive UI
- MCP (Model Context Protocol) server support
- AWS Bedrock/Cognito integrations
- Session management with teleport/continue
- Permission prompt system
- Update checking
- And more...

## Contributing

Feel free to:
- Add more tools
- Extract additional modules from `cli.js`
- Improve documentation
- Add TypeScript types
- Create tests

## License

See LICENSE.md for the original Claude Code license terms.
