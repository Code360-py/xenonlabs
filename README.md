# XenonLabs

C wrapper over [llama.cpp](https://github.com/ggml-org/llama.cpp).
Runs local LLMs on Termux and Android.

## Layout


## Host build

```sh
cmake -S . -B build -G Ninja
cmake --build build
ctest --test-dir build --output-on-failure
RUN
./build/xenonlabs-cli model.gguf "Hello" --stream
