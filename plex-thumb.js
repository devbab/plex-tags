const argv = require("minimist")(process.argv.slice(2));
const plex = require("./js/plex.js");
const sharp = require("sharp");
const fsPromises = require("fs").promises;
const path = require("path");

const usage = `
usage node plex-thumb.js
    --scan      : scan for missing thumb nails
        --force : force rebuilding all thumb images

    `;

// https://github.com/lovell/sharp

/**
 * 
 * @param {string} src source image with directory 
 * @param {string} dest  thumb image with directory. Directory may not exist
 * @return a promise
 */
function doThumb(src, dest) {
    //console.log("doThumb", path.dirname(dest));

    function build(src, dest) {
        //console.log("building thumb for", src);


        // https://sharp.pixelplumbing.com/api-resize
        return sharp(src)
            .rotate() // take into account the orientation flag in EXIF
            .resize({ width: 720, height: 512, fit: "inside", kernel: "cubic" })
            .toFile(dest);
    }

    // create the directory. whether it fails or not (existing/not existing), we launch the thumb creation
    return fsPromises.mkdir(path.dirname(dest), { recursive: true })
        .finally(() => {
            //    console.log("dir created");
            return build(src, dest);
        })

}

/**
 * write something on the console without newline
 * @param {*} txt 
 */
function consoleSameLine(txt) {
    process.stdout.clearLine();  // clear current text
    process.stdout.cursorTo(0);
    process.stdout.write(txt);
}



/******************** So what do we do with all that ?********* */

if (argv.h || argv.help) return console.log(usage);


async function rebuild() {
    console.log(`Listing images...`);
    plex.init();
    let result = plex.listPhotos(argv.f);
    plex.end();

    //result.length = 10000;

    console.log(`${result.length} Images`);

    let thumbDirectories = {};
    result.forEach(elt => {
        const destDir = path.dirname(elt.thumb_file);
        thumbDirectories[destDir] = 1;
    });
    thumbDirectories = Object.keys(thumbDirectories);
    console.log(`Thumb directories:`, thumbDirectories);


    let promises = [];
    let promisesStat = [];
    let processed = 0;

    function putThumbInStack(elt) {
        const p = doThumb(elt.file, elt.thumb_file)
            .then((resp) => {
                consoleSameLine(`Processed ${++processed} / ${promises.length}`, resp); // thumb is built
            })
            .catch(err => { console.error(`Error on ${elt.file}`, err) });

        // one more promises of building the thumb
        promises.push(p);
        consoleSameLine(`Processed ${processed} / ${promises.length}`);

    }

    for (let i = 0; i < result.length; i++) {
        const elt = result[i];
        const ext = elt.file.slice(-4).toLowerCase();
        switch (ext) {
            case ".arw": // tools doesn't know (yet) how to process raw file
            case ".mp4":
            case ".mpg":
            case ".mp3":
            case ".mov":
            case ".avi":
            case ".mts":
                continue;
        }

        if (argv.force) {
            putThumbInStack(elt);
        }
        else { // not forced, will do the job 
            //console.log(`checking`, elt);
            const ps = fsPromises.stat(elt.thumb_file)
                .catch(async (e) => {
                    if (e.code == "ENOENT") putThumbInStack(elt);
                });

            promisesStat.push(ps);

        }
    }

    // waiting for files to checked for existence
    await Promise.allSettled(promisesStat);

    // wait for all thumbs to be created, successed or failed
    await Promise.allSettled(promises);
    console.log();
    console.log(`Finished`);

}

rebuild();


