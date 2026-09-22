# XenonLabs

C wrapper over llama.cpp (Termux pkg: llama-cpp).

## Build
    cmake -S . -B build -G Ninja
    cmake --build build
    ctest --test-dir build --output-on-failure

## Run
    ./build/xenonlabs-cli model.gguf "What is gravity?" --chat --stream

## Options
    --stream    stream tokens as they generate
    --chat      wrap prompt in <|im_start|>...<|im_end|> template
    --max N     max tokens (default 256)
    --temp F    temperature (default 0.8)
    --verbose   show llama.cpp logs

## Env
    XENONLABS_VERBOSE=1   same as --verbose
