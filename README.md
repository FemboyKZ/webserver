# FKZ Webserver

wip

## Build

```bash
mkdir -p .cache/archives logs data 
docker build --no-cache --build-arg UID=$(id -u) --build-arg GID=$(id -g) -t webserver .
```
