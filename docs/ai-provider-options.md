# AI reply providers

The main reply provider is selected per account in Agent settings → Connection. OpenAI, Anthropic, Gemini and DeepSeek use the same knowledge retrieval, conversation context, marker parsing, verification and action authorization. A provider supplies candidate text; it does not bypass the verifier or gain permission to send files or book appointments.

The model field remains editable. Suggested model buttons help select supported IDs without making them an allowlist. Changing provider resets the model to that provider's default and clears the key input. Saving or testing another provider requires its own key; a stored key is never reused with a different provider. This release retains one active reply-provider configuration per account. It does not automatically switch paid providers or store multiple reply credentials.

DeepSeek suggestions are `deepseek-flash` and `deepseek-v4-pro`, with Flash as the default. These match the [official model list](https://api-docs.deepseek.com/api/list-models/). Requests use DeepSeek's [Chat Completions endpoint](https://api-docs.deepseek.com/api/create-chat-completion/) with thinking disabled so the existing bounded reply budget produces customer-facing text. Hidden reasoning is never substituted for an empty answer. Existing saved model IDs are preserved until changed by an administrator.

To configure DeepSeek, select it, choose a model, enter the key in the password field and use Test key, then Save. A successful test of an unsaved candidate does not clear the active account's provider error. Saving validates and encrypts the new key using the existing flow. Do not paste credentials into tickets, source files or chat.

Embeddings, voice transcription and image analysis retain their separate configurations. A DeepSeek reply key does not replace the OpenAI embedding/transcription key or the configured image-analysis key. Lexical knowledge retrieval remains available without embeddings.

The earlier behavior release remains disabled pending paid end-to-end validation and a fresh reviewed usefulness holdout. Adding a provider option does not activate it. No DeepSeek live generation has been tested without a supplied key; adapter and credential-routing tests use mocked responses.
