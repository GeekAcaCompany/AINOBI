# pdf2htmlEX

The service converts PDF pages with [pdf2htmlEX](https://github.com/pdf2htmlEX/pdf2htmlEX), licensed under the GNU General Public License v3. The Docker image installs its Ubuntu package, `pdf2htmlEX-0.18.8.rc1-master-20200630-Ubuntu-bionic-x86_64.deb`.

When that file is in this directory, the build uses it. Otherwise the build downloads the same file from the project's [v0.18.8.rc1 release](https://github.com/pdf2htmlEX/pdf2htmlEX/releases/tag/v0.18.8.rc1) and checks its SHA-256 (see `PDF2HTMLEX_DEB_SHA256` in the Dockerfile). Its source code is available from that release.
