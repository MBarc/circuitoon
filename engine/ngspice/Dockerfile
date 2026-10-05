# The engine build image (spec 2.2): the pinned emsdk image plus the autotools ngspice's autogen needs.
ARG EMSDK_IMAGE
FROM ${EMSDK_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends autoconf automake libtool bison flex patch make curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY versions.env build.sh /work/
COPY patches /work/patches
ENTRYPOINT ["bash", "/work/build.sh"]
