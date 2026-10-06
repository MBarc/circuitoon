#!/usr/bin/env bash
# Regenerates patches/0001-emscripten-build.patch from the pinned tarball (spec 2.2: our patches as
# .patch files). Run in the build image:
#   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/engine/ngspice:/work" <EMSDK_IMAGE> bash /work/make-patches.sh
set -euo pipefail
source /work/versions.env
cd /tmp && rm -rf a b && mkdir a
curl -fsSL -o ng.tgz "$NGSPICE_URL"
echo "$NGSPICE_SHA256  ng.tgz" | sha256sum -c -
tar xzf ng.tgz -C a --strip-components=1
cp -r a b && cd b
must() { grep -q "$1" "$2" || { echo "make-patches: '$1' not found in $2"; exit 1; }; }
# From eecircuit's hicum2_patch.sh: hicum2 is C++, which the WASM build leaves out.
must 'AC_CHECK_LIB(stdc++' configure.ac
sed -i '/AC_CHECK_LIB(stdc++/d' configure.ac
sed -i '/AC_SUBST(XTRALIBS/d' configure.ac
sed -i '/src\/spicelib\/devices\/hicum2\/Makefile/d' configure.ac
sed -i '/tests\/hicum2\/Makefile/d' configure.ac
sed -i '/spicelib\/devices\/hicum2\/libhicum2.la/d' src/Makefile.am
sed -i '/^[[:space:]]*hicum2[[:space:]]*\\\?/d' src/spicelib/devices/Makefile.am
sed -i '/get_hicum_info/d' src/spicelib/devices/dev.c
sed -i '/^[[:space:]]*hicum2[[:space:]]*\\\?[[:space:]]*$/d' tests/Makefile.am
# From eecircuit's run.sh: emcc's clang has no -Wno-unused-but-set-variable; emscripten has no getrusage.
must 'Wno-unused-but-set-variable' configure.ac
sed -i 's/-Wno-unused-but-set-variable/-Wno-unused-const-variable/g' configure.ac
must 'AC_CHECK_FUNCS(\[times getrusage\])' configure.ac
sed -i 's/AC_CHECK_FUNCS(\[times getrusage\])/AC_CHECK_FUNCS([times])/' configure.ac
# Ours (ruling R11): XSPICE core yes, code-model tools no (cmpp would have to run at build time,
# and code models load with dlopen).
must 'SUBDIRS = mif cm enh evt ipc idn cmpp icm verilog vhdl' src/xspice/Makefile.am
sed -i 's/^SUBDIRS = mif cm enh evt ipc idn cmpp icm verilog vhdl$/SUBDIRS = mif cm enh evt ipc idn/' src/xspice/Makefile.am
cd /tmp
# Strip diff's file timestamps so the patch is byte-identical on every run.
{ diff -ruN a b || [ $? -eq 1 ]; } | sed -E 's/^((---|\+\+\+) [^\t]+)\t.*$/\1/' > /work/patches/0001-emscripten-build.patch
echo "make-patches: wrote patches/0001-emscripten-build.patch ($(wc -l < /work/patches/0001-emscripten-build.patch) lines)"
