"use strict";
require("dotenv").config();
require("colors");
const fsPromises = require("fs").promises;
const yesno = require("yesno");
const log = require("@devbab/logger").child({ label: "Plex-scan" });
if (process.env.logger) log.setLevel(process.env.logger);

const API_KEY = process.env.API_KEY || ""; // put your API_KEY from developer.here.com here

// where to put temporary files
const TMP = process.env.TMP || "c:/temp";

const MAX_QUEUE = 10000; // max number of images in the queue or in RGC. 10000 seems OK

const fs = require("fs");
const path = require("path");
const argv = require("minimist")(process.argv.slice(2));
const request = require("superagent");
const plex = require("./js/plex.js");
const exif = require("./js/exif.js");
const plexFaces = require("./js/plex-face.js");
const plexPlaces = require("./js/plex-place.js");
const { name, version } = require("./package.json");


// array of {latlng: "lat,lng" ,ids: [rec.mid], file}  where mid =  media_items.metadata_item_id
let ForRGC = [];

// array of mids 
let ForFace = [];

// array of mids 
let ForNoEXIF = [];

let loopId;


const usage = `
    Version: ${version}
    Database in use: ${plex.whichDB()}

    usage node plex-scan.js [-h] [-l] [-g [-f]] [-s jobId]
    -h : show this help
    --patch         add fields in database to manage PLACES and FACES
    --scan        scan new photos for GPS Location and FACE.
        --nogeo:  do not run bach reverse geocode 

    --delplace      delete all Places from library
     `



function findXmlTag(res, tag) {
    let regex = new RegExp(`(<${tag}>)([A-z0-9]+)(</${tag}>)`);
    let id = res.match(regex);
    if (id) return id[2];
    else return null;
}

function gid2Filename(gid) {
    return path.join(TMP, "bgc_" + gid + ".txt");
}
/**
 * prend le ficher TheRGC et lance le batch reversege geocoding
 */

function runBatchGC() {
    if (ForRGC.length == 0)
        return console.log("No new GPS location to convert"); // eslint-disable-line no-console

    let url = [
        "https://batch.geocoder.ls.hereapi.com/6.2/jobs?",
        "apiKey=",
        API_KEY,
        "&mode=retrieveAddresses",
        "&action=run",
        "&header=true",
        "&inDelim=|",
        "&outDelim=|&outCols=city,county,district,country",
        "&outputcombined=true",
        "&language=en",
    ].join("");

    // limit to a certain limit of RGC to void overlaod of transactions but also not too big requests on Plex Media Server, even though limit is unclear
    if (ForRGC.length > MAX_QUEUE) ForRGC.length = MAX_QUEUE;

    let i = 0;
    let body =
        "recId|prox\n" +
        ForRGC.map(elt => { return `${i++}|${elt.latlng}`; }).join("\n");


    request
        .post(url)
        .send(body)
        .set("Content-Type", "text/plain")
        //      .set('Accept', 'application/xml')
        .then((res) => {

            let result = res.body.toString();

            //console.log(result);
            // extrait ReqestId
            const gid = findXmlTag(result, "RequestId");
            if (!gid)
                return console.error("No RequestId found");

            console.log(); // eslint-disable-line no-console
            console.log(`${ForRGC.length} coords sent for reverse geocoding`); // eslint-disable-line no-console
            console.log(`To check status: node plex-geo.js --check ${gid} `); // eslint-disable-line no-console

            // write temp file with the request to batch geocoder
            const matching = ForRGC.map(elt => elt.mids).join("\n");
            const fileOut = gid2Filename(gid);
            fs.writeFile(fileOut, matching, (err) => {
                if (err) throw err;
            });
        })
        .catch((err) => {
            console.error("Error requesting batch geocode", err.message);
        });
}




function consoleSameLine(txt) {
    process.stdout.clearLine();  // clear current text
    process.stdout.cursorTo(0);
    process.stdout.write(txt);
}

/**
 * Analyse EXIF
 * look for GPS coordinate in the image, and mark for RGC or no RGC
 * RGC : add in ForRGC
 * No RGC : add in NoRGC
 * @param {*} rec 
 * @returns a promise with 1 if new RGC to do, 0 otherwise
 */
function analyseEXIF(rec) {

    return exif.analyze(rec.file).then(tags => {

        log.debug("analyseEXIF file, tags ", rec.file, tags);

        const resp = { rgc: 0, face: 0, id: loopId };

        if (tags.pos == null && !tags.faces?.length) {
            log.debug(`${rec.file} has no GPS nor faces`);
            ForNoEXIF.push(rec.mid); // mark as to update, we will not process it
            return resp;
        }

        // if we have pos tag, then let's work on the coordinate
        if (tags.pos != null) {
            const elt = ForRGC.find(n => n.latlng == tags.pos.latlng);  // check if we have it already in the latlng ot process
            if (elt) { //we have the location already in the table TheRGC, no need to rgc again
                log.debug(`${rec.file} has same GPS as another image to process`);
                elt.mids.push(rec.mid); // add the media_item_id of table media_items
            }
            else {
                log.debug(`${rec.file} has GPS to process`);

                ForRGC.push({
                    latlng: tags.pos.latlng,
                    mids: [rec.mid],
                    file: rec.file,
                });
                resp.rgc = 1;
            }
        }

        // do we have some faces to process ?
        if (tags.faces?.length > 0) {
            log.debug(`${rec.file} has faces`);

            resp.face = 1;

            ForFace.push({
                mid: rec.mid,
                faces: tags.faces
            });

        }
        return resp;

    })
        .catch(console.error);
}

/**
 * Go through all Images to see which one to RGC or to add Face
 * @returns 
 */
async function scanForUpdate() {

    let recs = plex.listPhotosPatched();
    log.info(`ScanforUpdate: Total photos under review: ${recs.length} \n`);

    if (recs.length == 0) return;

    // go through all images 
    let promises = [];
    let countRGC = 0; //how many RGC to do have we received
    let countFace = 0; //how many Faces to process
    let stop = false;
    let promisesProcessed = 0;

    loopId = 0;
    do {
        if (stop) {
            console.log();
            console.log("we have reached the maximum queue size. When finished, launch again to continue the scan");
            log.info(`ScanforUpdate: maximum queue size reached after ${loopId} scans `);

            break;
        }
        const rec = recs[loopId];
        let oldestUpdate, A, B;

        if (!rec.PlaceUpdateTime) rec.PlaceUpdateTime = "1970-01-01"; // no update time

        if (!rec.FaceUpdateTime) rec.FaceUpdateTime = "1970-01-01"; // no update time

        A = Date.parse(rec.PlaceUpdateTime);
        B = Date.parse(rec.FaceUpdateTime);
        oldestUpdate = Math.max(A, B);


        consoleSameLine(`${loopId + 1}/${recs.length} scanned, Queuing: ${promisesProcessed}/${promises.length}, WithPlace: ${countRGC}, WithFace: ${countFace}, NoEXIF: ${ForNoEXIF.length}`);

        // what is update time of the file ?
        const stat = await fsPromises.stat(rec.file).catch(() => { });
        if (!stat) continue;

        //console.log(`\ndates: ${stat.mtimeMs}, ${oldestUpdate}`);
        if (stat.mtimeMs > oldestUpdate) { // file most recent than oldest update

            //console.log(`${count} for RGC / ${i} scanned ${rec.file} fresher than PlaceUpdate `, stat.mtimeMs, datePlaceUpdate);
            consoleSameLine(`${loopId + 1}/${recs.length} scanned, Queuing: ${promisesProcessed}/${promises.length}, WithPlace: ${countRGC}, WithFace: ${countFace}, NoEXIF: ${ForNoEXIF.length}`);

            // if (promises.length < 4) console.log(`analysing ${rec.file} (mid: ${rec.mid})  Place:${rec.PlaceUpdateTime} Face: ${rec.FaceUpdateTime}, ${stat.mtimeMs} > ${oldestUpdate}`);

            const p = analyseEXIF(rec);
            promises.push(p);

            // if (promises.length >= MAX_QUEUE) stop = true;

            p.then(elt => {
                countRGC += elt.rgc;
                countFace += elt.face;
                promisesProcessed++;
                consoleSameLine(`${elt.id + 1}/${recs.length} scanned, Queuing: ${promisesProcessed}/${promises.length}, WithPlace: ${countRGC}, WithFace: ${countFace}, NoEXIF: ${ForNoEXIF.length}`);
            });
        }
    } while (loopId++ < recs.length - 1);


    //wait for all promises
    await Promise.all(promises);
    console.log();
    console.log(`End of scan`);
    exif.end(); // we terminate the exif engine

    console.log();
    console.log(`ForPlace`, ForRGC.length);
    console.log(`ForFace`, ForFace.length);
    console.log(`ForNoEXIF`, ForNoEXIF.length);

    await plexFaces.addFaces(ForFace);
    if (ForNoEXIF.length > 0) await plex.markImagesAsUpdated(ForNoEXIF, ["FACE", "PLACE"]);

    // we are good to run the batch RGC
    if (!argv.nogeo) runBatchGC();

}

/******************** So what do we do with all that ?********* */
if (!API_KEY) {
    console.log(`Missing credentials !`.red);
    console.log(`1/ create credentials from https://developer.here.com`.yellow);
    console.log(
        `2/ add API_KEY as environment variable or put it into file plex-place.js`
            .yellow
    );
    process.exit(0);
}

if (argv.patch) {
    plex.init();
    plex.patch();
    plex.end();
}

if (argv.h || argv.help) {
    console.log(usage); // eslint-disable-line no-console
    process.exit(0);
}


async function deleteAllPlaces() {
    const ok = await yesno({
        question: 'Are you sure you want to delete ALL places in the Plex database ?'
    });
    if (!ok) return;
    plexPlaces.deleteAllPlaces();
}
if (argv.delplace) deleteAllPlaces();



if (argv.scan) {
    plex.init();
    scanForUpdate();
    plex.end();

}


