(async()=>{
const axios = require("axios");
const Jimp = require("jimp");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
let unknown;
let opt = {
	string: [ "file", "output", "expiry" ],
	boolean: [ "help", "random", "reverse", "dither", "ignore", "quiet", "debug" ],
	alias: {
		"help": [ "?" ],
		"file": [ "f" ],
//		"width": [ "w" ], // resizing currently doesn't work
//		"height": [ "h" ],
		"dither": [ "d" ],
		"x": [ "x_" ], // this is required otherwise it'll think this is unknown
		"y": [ "y_" ],
		"random": [ "r" ],
		"reverse": [ "R" ],
		"ignore": [ "i" ],
		"debug": [ "D" ],
		"quiet": [ "q" ],
		"output": [ "o" ],
		"expiry": [ "e" ],
	},
	unknown: (e) => { unknown = e; },
};
const argv = require("minimist")(process.argv.splice(2), opt);
if (argv.help) {
	console.error("required:");
	console.error("  --file -f       what file to draw");
	console.error("  -x              left-most pixel of the image");
	console.error("  -y              top-most pixel of the image");
	console.error("use -x-5 or -x=-5 for negative numbers, -x -5 won't work");
	console.error("image:");
//	console.error("  --width -w      width of image");
//	console.error("  --height -h     height of image");
//	console.error("if both width and height are left out, image size will be left as is");
	console.error("  --random -r     draw each pixel in a random order");
	console.error("  --reverse -R    reverse order to draw pixels");
	console.error("  --dither -d     dither the image");
	console.error("  --ignore -i     don't draw white pixels, act as if all pixels are white by default");
	console.error("output:");
	console.error("  --debug -D      don't actually draw anything, just say what would be drawn");
	console.error("  --quiet -q      don't output anything, overrides --debug");
	console.error("  --output -o     output image of what would be drawn to a file");
	console.error("  --expiry -e     expiry time of cache, default: 1h");
	console.error("  --help -?       help");
	console.error("");
	return 8;
}
if (unknown == null && argv._.length) unknown = argv._[0];
if (unknown) {
	console.error("unexpected", unknown);
	return 7;
}
const isStr = (e, a) => {
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
if (argv.output != null) {
	if (isStr(argv.output, "--output")) return 7;
}
if (!argv.debug || !argv.quiet) {
	if (argv.x == null && argv.y == null && argv.debug)
		argv.x = argv.y = 0;
	if (isNum(argv.x, "-x")) return 7;
	if (isNum(argv.y, "-y")) return 7;
	if (argv.width != null || argv.height != null) {
		if (isNum(argv.width,  "--width", true))  return 7;
		if (isNum(argv.height, "--height", true)) return 7;
	}
} else {
	argv.x = argv.y = argv.width = argv.height = null;
}
if (argv.expiry == null) argv.expiry = "1h";
if (isStr(argv.expiry, "--expiry")) return 7;
let expiryMatch = argv.expiry.match(/^(?:([0-6])d)?(?:([0-9]|1[0-9]|2[0-3])h)?(?:([0-9]|[1-5][0-9])m)?(?:([0-9]|[1-5][0-9])s)?$/i);
if (!expiryMatch) { console.error("invalid --expiry"); return 7; }
let expiryTime = 0;
if (expiryMatch[1]) expiryTime += parseInt(expiryMatch[1]) * 24 * 3600e3;
if (expiryMatch[2]) expiryTime += parseInt(expiryMatch[2]) * 3600e3;
if (expiryMatch[3]) expiryTime += parseInt(expiryMatch[3]) * 60e3;
if (expiryMatch[4]) expiryTime += parseInt(expiryMatch[4]) * 1e3;
delete expiryMatch;
if (isStr(argv.file, "--file")) return 7;
if (argv.debug && argv.quiet && !argv.output) return 0;
const paletteFile = path.resolve(__dirname, "./palette.png"); // read palette image
const palette = await Jimp.read(paletteFile);
let colors_ = [];
palette.scan(0, 0, palette.bitmap.width, palette.bitmap.height, (x, y, i) => {
	if (palette.bitmap.data[i + 3] > 127) // make sure the color isn't transparent
		colors_.push([palette.bitmap.data[i + 0], palette.bitmap.data[i + 1], palette.bitmap.data[i + 2]]); // no need for alpha
});
const colorNames = [
	"white", "light gray", "dark gray", "black", "pink", "red", "orange", "brown",
	"yellow", "light green", "green", "aqua", "cyan", "blue", "magenta", "purple"
];
const colors = colors_; delete colors_;
process.chdir(__dirname);
require("dotenv").config();
const ax = axios.create({
	baseURL: "https://pixelcanvas.io/api/",
	timeout: 10000,
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
		.reduce((a,b) => { a[b[0]] = b[1]; return a }, {}),
});
const chunkSize = 64;
const bigChunks = 15;
const bigChunkSize = chunkSize*bigChunks;
const bigChunkDiff = chunkSize*7;
const chunkCache = {};
const getChunk = async (cx, cy) => {
	let cacheName = `${cx}.${cy}`;
	if (Date.now() - expiryTime > chunkCache[cacheName]?.creation) {
		delete chunkCache[cacheName];
	}
	if (!chunkCache[cacheName]) {
		let res = await ax({
			method: "get",
			url: `bigchunk/${cx}.${cy}.bmp`,
			responseType: "arraybuffer"
		});
		let chunks = [];
		for (let j = 0; j < bigChunks**2; ++j) { // loop all 15x15 chunks
			chunks.push(Buffer.alloc(chunkSize**2)); // add to chunk array
			for (let i = 0; i < chunkSize**2/2; ++i) {
				let i_ = i + (j/2*chunkSize**2);
				chunks[j][i*2]   = res.data[i_] >> 4; // high byte
				chunks[j][i*2+1] = res.data[i_] & 0x0F; // low byte
			}
		}
		delete res;
		let bigChunk = [];
		for (let j = 0; j < bigChunkSize**2; ++j) {
			let x_ = j % bigChunkSize; // current x
			let y_ = Math.floor(j / bigChunkSize); // current y
			let i_ = Math.floor(x_ / chunkSize) + Math.floor(y_ / chunkSize) * bigChunks; // current chunk index
			let x = x_ % chunkSize; // current x in chunk
			let y = y_ % chunkSize; // current y in chunk
			let i = x + y * chunkSize; // current index in chunk
			bigChunk.push(chunks[i_][i]);
		}
		delete chunks;
		chunkCache[cacheName] = { creation: Date.now(), data: bigChunk };
	}
	return chunkCache[`${cx}.${cy}`];
};
// mod converts a position to the position in that chunk
const mod = (e) => (e+bigChunkDiff<0 ? bigChunkSize-1-(-e-1-bigChunkDiff)%bigChunkSize : (e+bigChunkDiff)%bigChunkSize);
// div converts a position to what chunk it's in
const div = (e) => e==0?0 : Math.floor((e+bigChunkDiff)/bigChunkSize)*15;
// gets the color of the pixel at a position
const getPixel = async (x, y) => (await getChunk(div(x),div(y))).data[mod(x)+mod(y)*bigChunkSize];
const doSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const sleep = async (ms, a, b) => {
	const sec_ = Math.floor(ms / 1000);
	let sec = sec_;
	ms = ms % 1000;
	for (; sec > 0; --sec) {
		let str = ""; // human readable time
		if (sec >= 60*60*24*7) str += Math.floor(sec/(60*60*24*7)) + "w ";
		if (sec >= 60*60*24  ) str += Math.floor(sec/(60*60*24)%7) + "d ";
		if (sec >= 60*60     ) str += Math.floor(sec/(60*60)%24  ) + "h ";
		if (sec >= 60        ) str += Math.floor(sec/(60)%60     ) + "m ";
		if (sec >= 1         ) str += Math.floor(sec%60          ) + "s ";
		let text = `${a}/${b} ${Math.floor(a/b * 100)}%`;
		if (!argv.quiet) process.stderr.write(text + " " + str);
		await doSleep(1000);
		if (!argv.quiet) process.stderr.write("\x1b[2K\x1b[0G");
	}
	await doSleep(ms);
};
const drawPixel = async ({ x, y, color }) => {
	let skipped = argv.debug ? false : (color == await getPixel(x, y));
	if (!argv.quiet) console.log((skipped ? "skipped " : "") + "drawing pixel at", x, y, "with color", (color + 1).toString().padStart(2, 0), colorNames[color]);
	if (argv.debug) return { };
	if (skipped) return { };
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
const nearest = (r, g, b) => { // get nearest color
	let j;
	let dist = Infinity; // start at infinity, too lazy for null check
	for (let i = 0; i < colors.length; ++i) {
		let newDist = dist3d(r, g, b, ...colors[i]);
		if (newDist < dist) {
			dist = newDist;
			j = i;
		}
	}
	return j;
};
let image;
if ((argv.width && argv.height) || argv.dither) {
	const buf = await (await Jimp.read(argv.file)).getBufferAsync("image/png");
	// get Jimp to convert to PNG. if a user puts "png:-" for the file name,
	// magick will think we're putting the file in through stdin, and it'll hang.
	// this is a hacky work around
	var proc = spawn("magick", [
		"convert",
		...(argv.width && argv.height ? [
			// set flags if resizing, Jimp's resize is weird
			"-size", `${argv.width}x${argv.height}`
		] : []),
		...(argv.dither ? [
			// set flags if dithering
			"-dither", "FloydSteinberg", "-remap", paletteFile,
		] : []),
		"--", "png:-", "png:-" // input = stdin png, output = stdout png
	]);
	let buffers = [];
	proc.stdout.on("data", b => buffers.push(b)); // add the buffer to array
	proc.stdin.write(buf); // write the PNG image data
	delete buf; // don't need anymore
	proc.stdin.end(); // we're not writing anymore, close stdin
	await new Promise((resolve, reject) => {
		proc.once("error", reject);
		proc.once("exit", (c) => {
			if (c > 0) reject("magick exited with code", c);
			resolve();
		});
	});
	// concat the buffers into one and get Jimp
	// the output image won't have this if we use nearest in the scan function instead
	image = await Jimp.read(Buffer.concat(buffers));
	delete buffers; // don't need anymore
} else {
	image = await Jimp.read(argv.file);
}
image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, i) => {
	let [ r, g, b, a ] = image.bitmap.data.slice(i, i+4); // destructuring assignment OP
	if (a > 127) {
		[ r, g, b ] = colors[nearest(r, g, b)]; // get nearest color
		a = 255;
	} else {
		r = g = b = a = 0;
	}
	image.bitmap.data[i+0] = r;
	image.bitmap.data[i+1] = g;
	image.bitmap.data[i+2] = b;
	image.bitmap.data[i+3] = a;
});
if (argv.output) {
	await fs.promises.writeFile(argv.output, await image.getBufferAsync("image/png"));
}
if (argv.debug && argv.quiet) return 0;
let pixels = [];
image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, i) => {
	let [ r, g, b, a ] = image.bitmap.data.slice(i, i+4);
	if (a > 127) {
		let X = x + argv.x;
		let Y = y + argv.y;
		// don't need to use nearest twice
		let color = colors.map(e => e.join()).indexOf([r, g, b].join());
		// indexOf doesn't work with an array of arrays, but array of strings work
		if (color == 0 && argv.ignore) return; 
		pixels.push({ x: X, y: Y, color });
	}
});
delete image; // don't need anymore
if (argv.random) pixels.sort(() => Math.random() - 0.5); // shuffle array
if (argv.reverse) pixels.reverse(); // reverse array
for (let i = 0; i < pixels.length; ++i) {
	while (true) {
		try {
			let res = await drawPixel(pixels[i]);
			if (argv.debug) break; // don't sleep with --debug
			await sleep(Math.floor(res.waitSeconds * 1e3), i+1, pixels.length);
			break;
		} catch (err) {
			console.error(err);
			return 2;
		}
	}
}
return 0;
})().then(e => process.exit(e || 0));
