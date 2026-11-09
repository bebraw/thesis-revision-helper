# Try the sample document

This walkthrough uses a fictional thesis about a local research-note index. You can edit the source and use the revision workspace without a model. A local OpenAI-compatible model can add paragraph purposes and proposals.

## Open the sample

From the repository directory, use the pinned Node version and install the existing dependencies if needed:

```sh
nvm use
npm install
npm run app
```

Open `http://127.0.0.1:8787/app/` and select **Try the sample**. If a working copy is already open, confirm its replacement only after copying any text you want to keep. The tracked [sample](../examples/sample-thesis/main.tex) is not changed.

To work on your own file, copy its LaTeX text from your editor, paste it into **Paste a LaTeX document**, and select **Open pasted text**. The app works on one document at a time and does not read included files.

## Optional: connect a local model

Start a credential-free OpenAI-compatible model service on your computer and configure its endpoint and model name under **AI connection**. The endpoint must allow browser requests from the app's origin; consult the service's CORS configuration if it cannot connect. Selected passages and nearby context are sent directly to that service. You can skip this step and still edit the document and save revision drafts.

## Revise

1. Select a paragraph in the outline. If a model is connected, its purpose appears after a short pause and is labelled as an AI interpretation.
2. Select **Language** or **Clarity**. The original is a read-only reference, and **Your revision** starts with the original text.
3. If a model is connected, select **Generate proposal** to see **One possible revision**. It is a separate reference and does not change your draft or source. Proposals that fail preservation checks are rejected.
4. Edit **Your revision**, then select **Use my revision**. Review and confirm any warnings if they appear. The working copy now contains your text. **Undo revision** restores the passage.
5. To try draft recovery, open another revision, edit it, and select **Return to manuscript**. Reload the page and use **Saved drafts** to restore it.

## Copy your work back

Select **Copy source** and paste the result into your own LaTeX file. If clipboard access is unavailable, the app selects the source so you can copy it using your keyboard. The app cannot see or update the file in your editor and cannot detect changes made there.

Your working copy and drafts are stored in this browser's `localStorage` when available. Browser data can be cleared or blocked, so keep your file or another independent copy as a backup. Copy/paste transfers text and does not guarantee byte-identical file encoding or line endings.
