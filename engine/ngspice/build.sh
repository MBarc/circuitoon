#!/usr/bin/env bash
# Builds ngspice to WebAssembly (spec 2.2). Adapted from eecircuit-engine's MIT-licensed Docker/run.sh
# at EECIRCUIT_COMMIT (the emconfigure and emmake flow and the configure edits), but as a shared
# library with XSPICE, driven through its C API: no Asyncify, no interactive prompt, no PDK models.
# Writes /out/ngspice.mjs, /out/ngspice.wasm, /out/build-info.txt, /out/compiled-dirs.txt and
# /out/licence-scan.txt.
set -euo pipefail
source /work/versions.env
MODE="${BUILD_MODE_OVERRIDE:-$BUILD_MODE}"
mkdir -p /src /out && cd /src
curl -fsSL -o ngspice.tar.gz "$NGSPICE_URL"
echo "$NGSPICE_SHA256  ngspice.tar.gz" | sha256sum -c -
tar xzf ngspice.tar.gz && cd "ngspice-$NGSPICE_VERSION"
for p in /work/patches/*.patch; do patch -p1 < "$p"; done
./autogen.sh
mkdir release && cd release
# --disable-klu: 45.2 builds KLU by default (configure.ac: "Default=yes"); KLU's SuiteSparse sources
# (colamd among them) are LGPL, and ngspice's own Sparse 1.3 solver solves the same operating point.
# The smoke and accuracy tests prove it; if one fails only without KLU, enable it and list it in NOTICE.
COMMON="--disable-osdi --disable-klu --disable-debug --disable-openmp --without-x --with-readline=no"
# ngshared links pthread (configure's AC_CHECK_LIB). Emscripten's libc stubs cover the mutex calls,
# but -pthread would turn on shared memory (SharedArrayBuffer, COOP/COEP), which spec 2.2 rules out:
# strip it from every generated Makefile, and fail if any survives.
nopthread() {
  find . -name Makefile -exec sed -i -e 's/[[:space:]]-pthread\b//g' -e 's/[[:space:]]-sUSE_PTHREADS=1//g' {} +
  if grep -rl --include=Makefile -E '(^|[[:space:]])-pthread\b|USE_PTHREADS' . ; then echo "build: -pthread survived in the Makefiles above"; exit 4; fi
}
EXPORTS=_ngSpice_Init,_ngSpice_Command,_ngGet_Vec_Info,_ngSpice_CurPlot,_ngSpice_AllVecs,_ngSpice_SetBkpt,_ngSpice_nospinit,_malloc,_free
RUNTIME=addFunction,UTF8ToString,stringToUTF8,lengthBytesUTF8,getValue,FS,HEAPF64,HEAPU8
LINK="-O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createNgspice -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sALLOW_TABLE_GROWTH=1 -sSTACK_SIZE=4MB -sFORCE_FILESYSTEM=1"
if [ "$MODE" = shared ] || [ "$MODE" = shared-noxspice ]; then
  # Rung 1 (shared) or rung 2 (shared-noxspice): the same library and exports, so the same adapter.
  if [ "$MODE" = shared ]; then XSPICE=--enable-xspice; else XSPICE=--disable-xspice; fi
  emconfigure ../configure --with-ngshared $XSPICE $COMMON
  nopthread
  emmake make -j"$(nproc)" -C src
  # emsdk 6's libtool makes libngspice.so a wasm side module (dylink.0), which emcc would load with
  # dlopen at run time, and --disable-shared fails (the Makefiles compile with -shared). So link what
  # libtool linked into it: libngspice's own objects plus its convenience archives (libngspice_la_LIBADD).
  LAS=$(make -s -C src --no-print-directory --eval 'print-libadd: ; @echo $(libngspice_la_LIBADD)' print-libadd)
  LIB="$(ls src/.libs/libngspice_la-*.o) $(for la in $LAS; do case "$la" in *.la) echo "src/$(dirname "$la")/.libs/$(basename "${la%.la}").a";; esac; done)"
  for f in $LIB; do [ -f "$f" ] || { echo "build: $f missing"; exit 3; }; done
  emcc $LIB -o /out/ngspice.mjs $LINK -sEXPORTED_FUNCTIONS=$EXPORTS -sEXPORTED_RUNTIME_METHODS=$RUNTIME -lm
else
  # Rung 3 (spec 2.2, ruling R28): the executable, as in eecircuit, without XSPICE.
  emconfigure ../configure --disable-xspice $COMMON
  nopthread
  sed -i "s|\$(ngspice_LDADD) \$(LIBS)|\$(ngspice_LDADD) \$(LIBS) $LINK -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -o ngspice.mjs|" src/Makefile
  emmake make -j"$(nproc)" -C src
  cp src/ngspice.mjs src/ngspice.wasm /out/
fi
# Licence scan (spec 2.2): every source directory compiled in, and which mention a non-BSD licence.
# libtool puts objects in .libs/ directories: drop that last part so each entry names a source directory.
find src \( -name '*.o' -o -name '*.lo' \) -printf '%h\n' | sed -e 's|^src/||' -e 's|/\.libs$||' | sort -u > /out/compiled-dirs.txt
: > /out/licence-scan.txt
while read -r d; do
  hit=$(grep -l -E 'GNU (Lesser )?General Public|LGPL|GPL|Mozilla Public' "../src/$d"/*.[ch] 2>/dev/null | head -3 | tr '\n' ' ' || true)
  if [ -n "$hit" ]; then echo "$d: $hit" >> /out/licence-scan.txt; fi
done < /out/compiled-dirs.txt
{ echo "mode=$MODE"; echo "ngspice=$NGSPICE_VERSION"; echo "emsdk=$EMSDK_VERSION"; emcc --version | head -1; } > /out/build-info.txt
echo "build: done ($MODE)"; ls -la /out
