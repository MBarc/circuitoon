# Rebuilding and replacing Circuitoon's ngspice engine

1. Install Docker. From the Circuitoon repository root run `npm run engine:build`, or by hand:
   `docker build --build-arg EMSDK_IMAGE=<EMSDK_IMAGE from versions.env> -t circuitoon-ngspice engine/ngspice`
   then `docker run --rm -v "$PWD/engine/out:/out" circuitoon-ngspice`. From Git Bash on Windows,
   put `MSYS_NO_PATHCONV=1` in front of the `docker run` so `/out` stays a container path.
2. The build downloads the ngspice tarball named in versions.env, checks its SHA-256, applies
   patches/*.patch, configures with --with-ngshared --enable-xspice --disable-osdi --disable-klu and links
   ngspice.mjs and ngspice.wasm with the exported functions listed in build.sh.
3. To use a modified ngspice, change the source (or add a patch), rebuild, and copy the new
   ngspice.mjs and ngspice.wasm over public/sim/ (the site) or plugin/dist-cli/ (the CLI). Set
   wasmBytes and wasmSha256 in engine.json to the new file's size and SHA-256.
