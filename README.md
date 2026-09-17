# Serious Cooking

Serious Cooking is a static GitHub Pages website containing cooking references, recipes, technique notes, food-science material, charcuterie information, and an interactive AI cooking assistant.

The site is designed to run entirely from GitHub Pages.

## AI Chat

The **Ask Anything** section now includes a browser-based open-source AI model.

Unlike the previous version, the new chat does not require:

- Claude
- an Anthropic API key
- a Cloudflare Worker for chat
- a Python server
- Ollama
- a dedicated AI server
- a paid AI API

Instead, the AI model runs directly in the visitor's browser using WebGPU.

Current model:

    Llama-3.2-1B-Instruct-q4f16_1-MLC

The browser integration is implemented in:

    chat.js

The main website remains in:

    index.html


## How the AI Chat Works

When somebody opens the GitHub Pages site, the website itself loads normally.

The AI model is not downloaded immediately.

The first time somebody asks a question in **Ask Anything**, the browser loads the open-source model through WebLLM and runs it locally using WebGPU.

Architecture:

    GitHub Pages
         |
         v
    index.html
         |
         v
    chat.js
         |
         v
    WebLLM
         |
         v
    Llama 3.2 1B Instruct
         |
         v
    WebGPU in the visitor's browser

No Serious Cooking server is required to generate chat responses.


## First-Time Use

Open the published Serious Cooking site in a recent WebGPU-capable browser.

Chrome or Edge are recommended.

Select:

    Ask Anything

Before the model has loaded, the chat header displays:

    Local AI — loads on first question

Ask a question such as:

    Why did my beurre blanc break?

or:

    Explain what happens to collagen during a long braise.

or:

    What percentage of salt should I use for an equilibrium cure?

The first question causes the browser to download and initialize the AI model.

The first load can take noticeably longer than later questions because the model files need to be downloaded.

After loading, the status should change to:

    Local AI ready

Subsequent questions should be faster because model files may be cached by the browser.


## Privacy

The new Ask Anything AI inference runs locally in the visitor's browser.

The cooking conversation does not need to be sent to Claude or another hosted AI API.

The browser does need network access to download the WebLLM JavaScript and model files.


## Conversation Memory

The AI remembers previous messages during the current browser session.

For example:

    User:
    I am making a bordelaise for ribeye.

    AI:
    ...

    User:
    Can I substitute Madeira?

The second question includes the earlier conversation as context.

Refreshing or closing the page currently resets the AI conversation.


## AI Behavior

The model receives a culinary system prompt designed for an experienced cook.

It is instructed to:

- avoid treating the user as a beginner
- be precise and technical
- use professional kitchen terminology
- explain food science when relevant
- assist with cooking techniques
- assist with sauces and stocks
- suggest substitutions
- assist with recipe development
- troubleshoot cooking problems
- discuss charcuterie
- discuss curing
- discuss fermentation
- provide useful temperatures
- provide useful ratios
- provide useful timing guidance

The prompt is defined in `chat.js` under:

    const SYSTEM_PROMPT = ...


## Browser Requirements

The local AI feature requires WebGPU.

If WebGPU is unavailable, the chat status will display:

    WebGPU unavailable

The rest of Serious Cooking should continue to work normally even if the browser cannot run the AI model.

If the AI does not work, first test with a current version of Chrome or Edge.


## Important Limitation

This change currently replaces only the **Ask Anything** chat.

Other parts of the site may still use the older external Serious Cooking API.

In particular, recipe web search and some document-import functionality may still reference:

    serious-cooking-api.timmo59.workers.dev

Those features are separate from the new browser-based AI chat and can be migrated later.

Seeing that URL elsewhere in `index.html` does not mean the new Ask Anything chat is using Claude.


## Repository Layout

The important files are:

    Serious-Cooking/
    ├── README.md
    ├── index.html
    ├── chat.js
    └── .gitignore

### index.html

Contains the Serious Cooking website and chat interface.

Near the bottom of the page it loads:

    <script type="module" src="./chat.js"></script>

### chat.js

Contains:

- WebLLM initialization
- model selection
- culinary system prompt
- conversation history
- Send button handling
- Enter-to-send handling
- model loading status
- AI error handling


# Merging the AI Branch Into Main

These instructions are intended for Dad when the AI branch is ready to merge.

## Recommended Method: GitHub Pull Request

First determine the feature branch name:

    git branch --show-current

Make sure all work has been committed and pushed:

    git status

Then push the current branch if necessary:

    git push -u origin "$(git branch --show-current)"

On GitHub:

1. Open the Serious Cooking repository.
2. Find the recently pushed feature branch.
3. Click **Compare & pull request**.
4. Confirm the base branch is `main`.
5. Confirm the compare branch is the AI feature branch.
6. Review the changed files.
7. Create the Pull Request.
8. Review the diff.
9. Click **Merge pull request**.
10. Confirm the merge.

Expected changed files include:

    README.md
    index.html
    chat.js
    .gitignore

If GitHub Pages deploys from `main`, the updated site should publish automatically after the merge.


# Alternative: Merge From the Command Line

Fetch current repository information:

    git fetch origin

Switch to main:

    git checkout main

Update main:

    git pull --ff-only origin main

Merge the feature branch, replacing FEATURE_BRANCH with its real name:

    git merge FEATURE_BRANCH

If the merge succeeds:

    git push origin main


# Verify the Merge

After merging:

    git checkout main
    git pull --ff-only origin main

Confirm the files exist:

    ls -l index.html chat.js README.md

Confirm the new AI header exists:

    grep -n "Ask Anything — Local AI" index.html

Confirm the WebLLM chat module is loaded:

    grep -n 'chat.js' index.html

Confirm the configured model:

    grep -n 'MODEL_ID' chat.js

The model line should reference:

    Llama-3.2-1B-Instruct-q4f16_1-MLC


# Testing the Published Site

After GitHub Pages finishes deploying the new `main` branch, open the normal Serious Cooking website.

If the old version appears, perform a hard refresh.

Windows/Linux Chrome or Edge:

    Ctrl + Shift + R

macOS:

    Command + Shift + R

Go to:

    Ask Anything

The header should say:

    Ask Anything — Local AI

The smaller status text should initially say:

    Local AI — loads on first question


## Suggested AI Test

Ask:

    Explain why hollandaise breaks and give me the most reliable way to recover it.

The first request should load the AI model.

After initialization, the status should become:

    Local AI ready

Then ask a follow-up:

    What if it broke because the butter was too hot?

The AI should understand that the second question refers to the previous hollandaise discussion.


# Troubleshooting

## WebGPU Unavailable

If the site displays:

    WebGPU unavailable

try a current version of Chrome or Edge.

The rest of the site should still work.


## First AI Request Is Slow

This is expected.

The browser must download and initialize the model the first time it is used.

Later use should generally start faster because the browser can cache model resources.


## AI Model Fails to Load

Open the browser developer tools.

In Chrome or Edge:

    F12

Select:

    Console

Look for messages containing:

    WebLLM:

or:

    Local AI error:

These messages can help identify WebGPU, memory, download, or model initialization problems.


## Send Button Does Nothing

Check the browser console for JavaScript errors.

Verify `index.html` contains:

    <script type="module" src="./chat.js"></script>

Verify `chat.js` exists in the deployed repository.


## Old Claude Chat Still Appears

Perform a hard refresh:

    Ctrl + Shift + R

Also verify the deployed `main` branch contains:

    Ask Anything — Local AI


# Rolling Back

If the AI change causes problems after it is merged, the preferred rollback is to revert the merge commit rather than rewriting Git history.

Find recent commits:

    git log --oneline --decorate -20

Then revert the merge commit:

    git revert -m 1 MERGE_COMMIT_HASH

Push the revert:

    git push origin main


# Security Notes

Do not place secrets, API keys, passwords, or private tokens in:

    index.html
    chat.js

GitHub Pages files are public and downloadable by site visitors.

The browser-local AI design avoids the need to place an AI API key in the website.


# Future Improvements

Potential improvements include:

- streaming AI responses as they are generated
- Markdown rendering in responses
- a Clear Conversation button
- model selection
- persistent conversations
- recipe-aware AI context
- searching saved recipes
- using Serious Cooking reference material as AI context
- migrating document extraction away from Claude
- replacing the old Claude-powered recipe search
- automatically selecting larger models on more capable computers

The initial implementation intentionally keeps the AI integration simple so browser-based inference can be tested independently.
