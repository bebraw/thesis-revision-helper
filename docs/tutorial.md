# Try the sample project

This walkthrough uses a fictional thesis about a local research-note index. You can try source editing and the revision workspace without an AI provider. A configured Cloudflare Workers AI model adds paragraph purposes and proposals.

## Get ready

From the repository directory, use the pinned Node version and install the existing dependencies if needed:

```sh
nvm use
npm install
```

The tutorial command creates a temporary copy of the [sample project](../examples/sample-thesis/main.tex) and prints its directory. The app saves directly to that copy, keeping the tracked example unchanged. Temporary files may be removed by the operating system; copy the project somewhere permanent if you want to keep your changes.

## Optional: enable AI feedback

For live purposes and proposals, configure a Cloudflare account ID, an API token with Workers AI access, and a model that supports JSON mode. For example, in the same terminal:

```sh
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_AI_MODEL="@cf/meta/llama-3.1-8b-instruct"
printf 'Cloudflare API token: '
read -rs CLOUDFLARE_API_TOKEN
printf '\n'
export CLOUDFLARE_API_TOKEN
```

The token entry is hidden and is not written into the project. See Cloudflare's [Workers AI REST API guide](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) for account and token setup and its [JSON mode documentation](https://developers.cloudflare.com/workers-ai/features/json-mode/) for supported models. The app displays the configured provider before opening a project. When analysis or a proposal is requested, Cloudflare receives the selected passage and nearby context.

You can skip this step: the editor and student revision drafts still work, and analysis and proposal requests will report that the model is unavailable. Restart the app after changing model configuration.

## Open and revise

1. In the same terminal, run `npm run tutorial`. It prints the directory of a fresh sample copy and starts the app. Open `http://127.0.0.1:8789` in your browser.
2. Paste the printed **directory path**, not the `main.tex` filename, into **Project directory**, and select **Open project**. The file tree and source editor show the copied project.
3. In the outline, select **Paragraph 4**, beginning “The search was making it easier”. The selection moves to that passage in the source editor. If AI is configured, its purpose appears after a short pause and is labelled as an AI interpretation. The current slice analyses the selected paragraph; it does not yet produce the complete hierarchical outline described in the product spec.
4. Select **Language** or **Clarity**. The original is a read-only reference, and **Your revision** starts with the original text.
5. If AI is configured, select **Generate proposal** to see **One possible revision**. It is a separate reference and does not change your draft or the source. A model response that fails preservation checks is rejected; you can request another proposal or continue on your own.
6. Edit **Your revision**. For example, replace the first sentence with “The search helped the researcher find the notes.” Keep the following sentence and its `\emph{...}` command. You can also write a different version.
7. Select **Use my revision**. Review and confirm any warnings if they appear. The source editor now contains your text. Select **Undo revision** to restore the passage.
8. To try draft recovery, open another revision, edit it, and select **Return to manuscript**. The draft is saved separately; use **Saved drafts** to restore it for the same file.

Try selecting an Evaluation paragraph too: it contains inline mathematics and a reference command. These are useful for seeing how proposals preserve LaTeX syntax. Do not edit the same source files in another application at the same time; this is a single-user workflow.

## Finish

Stop the local service with `Ctrl+C` in its terminal. The copied `main.tex` contains your saved edits; the original under `examples/sample-thesis/` is unchanged. Revision drafts are stored separately under `~/Library/Application Support/Thesis Revision Helper/`.
