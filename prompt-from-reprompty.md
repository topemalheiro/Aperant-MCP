# Prompt from Reprompty

I need you to understand how Reprompty detects and manages VS Code: windows, and then create a Linux-native preset for the MCP Master LLM RDR Prompt Sending Mechanism.

Here's what Reprompty does:
- It detects VS Code: windows on Linux using kdotool (KDE Wayland) by searching window titles for "Visual Studio Code", "Kilo Code:", "Kimi Code:", etc.
- It uses Chrome DevTools Protocol (CDP) to send prompts to VS Code: extensions in the background.
- It has a layout daemon (reprompty-layout-cython) that positions windows using kdotool.
- It manages virtual desktops via kdotool/qdbus.

Your tasks:
1. Look at the Reprompty codebase (especially /home/tope/Projects/OS-Toolkit/Reprompty/reprompty/src/platform/linux.ts and src/core/cdp-client.ts) to understand the detection and CDP sending mechanisms.

2. Create the necessary scripts/configs so that Aperant-MCP can use Reprompty's Linux-native window detection and CDP sending as a proper preset in the "MCP Master LLM RDR Prompt Sending Mechanism". This should make the "paste a script below" options disappear or unnecessary — Linux native should just work with VS Code: extensions directly.

3. Make sure the preset knows about kdotool handles, the layout daemon socket at $XDG_RUNTIME_DIR/reprompty/daemon.sock, and how to send prompts via CDP on Linux.

Also note: Graphiti MCP failed to start due to a Docker network/connection reset error when pulling images. And llama-server is not installed yet — I want to use gemma or qwen3.6 27b models with the qwen embedding model eventually. But the main focus is the Linux preset for prompt sending.

Please implement this properly in the Aperant-MCP codebase.
