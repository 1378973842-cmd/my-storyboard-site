<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/deedd0d0-c9f2-49f5-a208-d24d0f900b9e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy [.env.example](.env.example) to `.env` in the project root and set:
   - `THIRD_PARTY_API_BASE` — your OpenAI-compatible API base URL
   - `THIRD_PARTY_API_KEY` — your API key (`sk-…` only, no `Bearer` prefix)
   - `TEXT_MODEL` / `IMAGE_MODEL` — model IDs exactly as your provider lists them
3. Run the app:
   `npm run dev`
