# rhmonitor CLI

A CLI tool to monitor your PascalCoin RandomHash miners.

![RandomHash monitor](https://raw.githubusercontent.com/Techworker/rhmonitor/master/rhmonitor.png)

## Installation with nodejs on your system

If you already have nodejs installed on your monitoring computer, you can
simply clone the repository, install dependencies and run the script.

```
git clone git@github.com:Techworker/rhmonitor.git
cd rhmonitor
npm install
npm start
```

## Via docker

If you have docker installed, you can run the monitor with this command:

```
docker run -it --rm \
    --name rhmonitor \
    -v "$PWD":/usr/src/app \
    -w /usr/src/app \
    node:10 npm install && npm start
```

## Via executable

The monitor comed packaged as executables for windows, macos and linux. Go to
the releases page to download the file that matches your operation system. 

https://github.com/Techworker/rhmonitor/releases

The executables come pre-packaged with nodejs, so they are rather big. Nothing
will be installed on your system.

## Configuration

The repository ships with a default config file, called `config.ini.dist`. 
Rename this file to `config.ini` and alter the configuration to your needs.

Please check the config file for the configuration possibilities. All options
are described there in detail.

