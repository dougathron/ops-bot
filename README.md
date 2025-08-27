# Ops Manual Agent (100% Browser, Free, Teams Tab-ready)

This project is a fully client-side Retrieval-Augmented Generation (RAG) assistant for your SOP/ops manuals. No servers, no paid APIs.

- **Free & private**: runs in the browser. Your files never leave the device.
- **Voice input**: via Web Speech API (Chrome/Edge/Android; iOS support varies).
- **Per-user tone**: neutral/brief/friendly/formal.
- **Your 4 actions**: 
  1) Find a section → lists procedures, with fallback.
  2) Find a procedure → lists sub-procedures, with fallback and “no sub-procedure” message.
  3) Summarize a SOP → shows flowchart image(s) if present in text, else offers choices.
  4) Who does what → shows RASCI image(s) if present, else offers choices.
- **Images from SharePoint**: if CORS blocks image rendering, the app shows a link (as requested).
- **Basic access gate**: simple passphrase prompt (edit `config.json`).

## Quick start (GitHub Pages)

1. Create a new repo named `ops-bot`.
2. Upload all files from this folder.
3. Settings → Pages → Branch: `main` (root) → Save.
4. Open your site URL. Set a passphrase on first run (or edit `config.json` locally).
5. Upload your PDF/DOCX/TXT manuals and start asking.

## Add to Microsoft Teams (no coding, no Azure bots)

1. In a Teams channel, click **+** (Add a tab).
2. Choose **Website**.
3. Paste your GitHub Pages URL.
4. Name the tab "Ops Manual Agent". Save.

> Your org admin must allow the Website tab. If blocked, ask IT to allow it or use a SharePoint page embedding the site.

## Notes

- The parser recognizes headings like `Section:`, `Procedure:`, `Sub-procedure:` or markdown `# / ## / ###` to build the hierarchy.
- To link flowcharts/RASCI: paste the image or SharePoint file URL in the relevant text. If it can’t render, the app will display a link.
- Everything runs locally; closing the tab clears memory (unless your browser restores state).

