### [PixelCanvas.io](https://pixelcanvas.io) bot

## ![Color Palette](palette_preview.png)

Setup:
- Install [Node.js](https://nodejs.org/) and [ImageMagick](https://imagemagick.org/)
- Clone the repository using `git clone https://github.com/mekb-turtle/pixel-canvas-bot.git` or download .zip/.tar.gz of the repository and extract it
- Run `npm i` in the directory to install the dependencies
- Create a new file called `.env` in the directory of the repository
- Go to [PixelCanvas.io](https://pixelcanvas.io)
- Open network tab in developer tools
- Click a pixel on the canvas to draw it
- Open one of the network requests that says `pixel` (not `online` or `X.Y.bmp`)
- Open the Request tab
- Add `FIREBASE=` followed by the value of `appCheckToken` from the request body to the `.env` file
- Add `FINGERPRINT=` followed by the value of `fingerprint` from the request body to the `.env` file
- Use `node . --help` for help

The `X-Firebase-AppCheck` header has recently been moved to `appCheckToken` in the request body. Tokens now expire must quicker, and a CAPTCHA has been added.

If you get 401 Unauthorized, your firebase token or fingerprint is invalid. Delete the `.env` file and redo the "Setup" starting from "Create a new file called `.env`".

If you get 412 Precondition Failed, you have placed a pixel too recently, your cooldown hasn't expired yet. The program should wait in intervals of 10 seconds until this is over.

I've only tested this on Artix Linux and Windows 10.

The countdown/progress indicator won't show correctly on some Windows versions.

