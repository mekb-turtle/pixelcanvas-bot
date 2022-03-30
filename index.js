(async()=>{
const axios = require("axios");
const Jimp = require("jimp");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
let unknown;
let opt = {
	string: [ "file" ],
	boolean: [ "help", "random", "dither" ],
	alias: {
		"help": [ "?" ],
		"file": [ "f" ],
		"width": [ "w" ],
		"height": [ "h" ],
		"dither": [ "d" ],
		"x": [ "x_" ],
		"y": [ "y_" ],
		"random": [ "r" ],
	},
	unknown: (e) => { unknown = e; },
};
const argv = require("minimist")(process.argv.splice(2), opt);
if (unknown == null && argv._.length) unknown = argv._[0];
if (unknown) {
	console.error("unexpected", unknown);
	return;
}
if (argv.help) {
	console.error("--help -?      help");
	console.error("--file -f      what file to draw");
	console.error("-x             left-most pixel of the image");
	console.error("-y             top-most pixel of the image");
	console.error("--width -w     width of image");
	console.error("--height -h    height of image");
	console.error("--random -r    draw each pixel in a random order");
	console.error("--dither -d    dither the image");
	console.error("if both width and height are left out, image size will be left as is");
	console.error("use -x-5 or -x=-5 for negative numbers, -x -5 won't work");
	console.error("dithering is recommended if the image contains colors that are close to each other, not recommended if it's small");
	console.error("dithering requires ImageMagick");
	return;
}
const isStr = (e, a, p) => {
	if (typeof e != "string" || e == null || e == "") {
		console.error(`missing ${a}`);
		return true;
	}
}
const isNum = (e, a, p) => {
	if (typeof e != "number" || e != Math.floor(e) && e >= 1e9 && e <= (p ? 0 : -1e9)) {
		console.error(e == null ? `missing ${a}` : `invalid ${a}`);
		return true;
	}
}
if (isNum(argv.x, "-x")) return;
if (isNum(argv.y, "-y")) return;
if (argv.width != null || argv.height != null) {
	if (isNum(argv.width,  "--width"))  return;
	if (isNum(argv.height, "--height")) return;
}
if (isStr(argv.file, "--file")) return;
const paletteFile = path.resolve(__dirname, "./palette.png");
const palette = await Jimp.read(paletteFile);
let colors_ = [];
palette.scan(0, 0, palette.bitmap.width, palette.bitmap.height, (x, y, i) => {
	if (palette.bitmap.data[i + 3] > 127)
		colors_.push([palette.bitmap.data[i + 0], palette.bitmap.data[i + 1], palette.bitmap.data[i + 2]]);
});
const colors = colors_; delete colors_;
require("dotenv").config();
const ax = axios.create({
	baseURL: "https://pixelcanvas.io/api/",
	timeout: 5000,
	headers: `User-Agent: Mozilla/5.0 (Windows NT 10.0; rv:91.0) Gecko/20100101 Firefox/91.0
X-Firebase-AppCheck: ${process.env.FIREBASE}
Origin: https://pixelcanvas.io
Referer: https://pixelcanvas.io
DNT: 1
Sec-Fetch-Dest: empty
Sec-Fetch-Mode: cors
Sec-Fetch-Site: same-origin
Cache-Control: no-cache
TE: trailers`
		.split("\n")
		.map(e => [ e.split(": ")[0], e.split(": ").splice(1) ])
		.reduce((a,b) => { a[b[0]] = b[1]; return a },{}),
});
const doSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const sleep = async (ms) => {
	let sec = Math.floor(ms / 1000);
	ms = ms % 1000;
	for (; sec > 0; --sec) {
		let str = "";
		if (sec >= 60*60*24*7) str += Math.floor(sec/(60*60*24*7)) + "w ";
		if (sec >= 60*60*24  ) str += Math.floor(sec/(60*60*24)%7) + "d ";
		if (sec >= 60*60     ) str += Math.floor(sec/(60*60)%24  ) + "h ";
		if (sec >= 60        ) str += Math.floor(sec/(60)%60     ) + "m ";
		if (sec >= 1         ) str += Math.floor(sec%60          ) + "s ";
		process.stdout.write(str);
		await doSleep(1000);
		process.stdout.write("\x1b[2K\x1b[0G");
	}
	await doSleep(ms);
};
const drawPixel = async ({ x, y, color }) => {
	console.log("drawing pixel at", x, y, "with color", color + 1, "#" + colors[color].map(e => e.toString(16).padStart(0, 2)).join(""));
	let res = await ax({
		method: "post",
		url: "pixel",
		data: {
			x, y, color,
			fingerprint: process.env.FINGERPRINT,
			token: null,
			wasabi: x + y + 2342
		}
	});
	if (!res.data.result.data.success) throw res.data.result;
	return res.data.result.data;
};
const dist3d = (x1, y1, z1, x2, y2, z2) => Math.sqrt(((x1-x2)**2) + ((y1-y2)**2) + ((z1-z2)**2));
const nearest = (r, g, b) => {
	let j;
	let dist = Infinity;
	for (let i = 0; i < colors.length; ++i) {
		let newDist = dist3d(r, g, b, ...colors[i]);
		if (newDist < dist) {
			dist = newDist;
			j = i;
		}
	}
	return j;
};
let file;
if (argv.dither) {
	const im = await Jimp.read(argv.file);
	const imBuf = await im.getBufferAsync("image/png");
	var proc = spawn("magick", [
		"convert", "-dither", "FloydSteinberg", "-remap", paletteFile, "--", "png:-", "png:-"
	]);
	let buffers = [];
	proc.stdout.on("data", b => buffers.push(b));
	proc.stdin.write(imBuf);
	proc.stdin.end();
	await new Promise((resolve, reject) => {
		proc.once("error", reject);
		proc.once("exit", (c) => {
			if (c > 0) reject("magick exited with code", c);
			resolve();
		});
	});
	file = Buffer.concat(buffers);
} else {
	file = argv.file;
}
const image = await Jimp.read(file);
if (argv.width && argv.height)
	image.resize(argv.width, argv.height);
let pixels = [];
image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, i) => {
	let r = image.bitmap.data[i + 0];
	let g = image.bitmap.data[i + 1];
	let b = image.bitmap.data[i + 2];
	let a = image.bitmap.data[i + 3];
	if (a > 127) {
		let X = x + argv.x;
		let Y = y + argv.y;
		let color = nearest(r, g, b);
		pixels.push({ x: X, y: Y, color });
	}
});
if (argv.random) pixels.sort(() => Math.random() - 0.5);
for (let i = 0; i < pixels.length; ++i) {
	while (true) {
		try {
			let res = await drawPixel(pixels[i]);
			await sleep(Math.floor(res.waitSeconds * 1e3));
			break;
		} catch (err) {
			console.error(err);
			await sleep(10e3);
		}
	}
}
})();
