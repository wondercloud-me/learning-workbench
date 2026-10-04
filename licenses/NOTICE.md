# Local speech components

- SenseVoice Small: FunAudioLLM / FunASR, Alibaba Group. Original model https://huggingface.co/FunAudioLLM/SenseVoiceSmall. INT8 ONNX conversion by sherpa-onnx contributors, https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html. We preserve the model name and attribution; weights follow the FunASR Model Open Source License Agreement, included in SenseVoice-MODEL-LICENSE.txt.
- sherpa-onnx v1.13.8: k2-fsa contributors, Apache-2.0, https://github.com/k2-fsa/sherpa-onnx. This application bundles the macOS arm64 static offline recognition executable from the official release. The archive SHA-256 is pinned in scripts/prepare-speech.mjs.
- ONNX Runtime: Microsoft Corporation, MIT; license included in onnxruntime-LICENSE.txt. Statically linked by the sherpa-onnx release.
- macOS speech synthesis: supplied by the operating system, no TTS model weights bundled.

Source and binary downloads are documented in scripts/prepare-speech.mjs. Model files are unchanged; code-signing during application packaging can change the executable signature.

- UI icons: @vscode/codicons (Microsoft), CC-BY-4.0, https://github.com/microsoft/vscode-codicons. Icons are used consistently in the sidebar, workspace tabs and settings.
