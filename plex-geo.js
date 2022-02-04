"use strict";
require("dotenv").config();
const debug = require("debug")("Geo");

require("colors");
const fsPromises = require("fs").promises;
const yesno = require("yesno");

const API_KEY = process.env.API_KEY || ""; // put your API_KEY from developer.here.com here

// where to put temporary files
const TMP = process.env.TMP || "c:/temp";


const MAX_QUEUE = 5000; // max number of image exif to be put in queue

const fs = require("fs");
const path = require("path");
const argv = require("minimist")(process.argv.slice(2));
const request = require("superagent");
const unzipper = require("unzipper");
const etl = require("etl");
const csv = require("csvtojson");
const plex = require("./js/plex.js");
const exif = require("./js/exif.js");
const iso = require("./js/iso3166.js");
const plexPlaces = require("./js/plex-place.js");

const usage = `
    usage node plex-geo.js [-h] [-l] [-g [-f]] [-s jobId]
    -h : show this help
    --list          list existing places
    --check jobId   check that job is completed
    --set jobId     set places into Plex from jobId
    --delete        delete all Places from library
    --debug         to see various traces
    `;


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



// get result of batch geocoding, match to correspondance file and add EXIF
function addPlaces(gid) {
  debug("addPlaces");

  // now get result of batch geocoding
  let url = [
    "https://batch.geocoder.ls.hereapi.com/6.2/jobs/",
    gid,
    "/result?",
    "apiKey=",
    API_KEY,
  ].join("");

  // read matching file = for each line, a comma list mids
  const fileOut = gid2Filename(gid);

  let data = null;
  try {
    data = fs.readFileSync(fileOut, "utf8");
  } catch (err) {
    console.error(err.message);
  }

  if (!data) return;

  // each line contains one or several mid
  // mid = media_items.metadata_item_id
  const mids = data.split("\n");
  const allmids = data.match(/\d+/g);


  // lit et dezippe la réponse
  // une seule entrée ou plusieurs ? not clear in HERE batch geocoding dcoument
  request
    .get(url)
    .pipe(unzipper.Parse())
    .pipe(
      etl.map(async (entry) => {
        const content = await entry.buffer();
        const txt = content.toString();

        let tags = [],
          empty = [];
        csv({
          noheader: false,
          delimiter: "|",
        })
          .fromString(txt)
          .subscribe((json) => {
            if (json.SeqNumber == "1") tags.push(json);
            if (json.seqLength == "0")
              // no result for this entry
              empty.push(json);
          })
          .on("done", async () => {
            // console.log("unzipped the result of rgc");

            // for backup purpose, write result of rgc
            const fileRgc = `${fileOut}_result.json`;
            fs.writeFile(fileRgc, JSON.stringify(tags, null, 2), (err) => {
              if (err) console.error(`Error writing ${fileRgc}`, err);
              //console.log(`Note: RGC results written in file ${fileRgc}`);
            });

            // collect all tags,and add country as full text 
            tags = tags.map((rec) => {
              rec.country = iso.whereAlpha3(rec.country).country;
              return rec;
            });

            // add the new places
            await plexPlaces.addPlaces(mids, tags);

            // mark all the mids as updated
            await plex.markImagesAsUpdated(allmids, ["PLACE"]);


          });
      })
    );
}

// check if result is available
function checkResultAvailable(gid) {
  if (!gid || typeof gid !== 'string')
    return console.log(usage);

  // now get result of batch geocoding
  let url = [
    "https://batch.geocoder.ls.hereapi.com/6.2/jobs/",
    gid,
    "?action=status",
    "&apiKey=",
    API_KEY,
  ].join("");

  // lit et dezippe la réponse
  // une seule entrée ou plusieurs ? not clear in HERE batch geoding dcoument
  request
    .get(url)
    .then((status) => {
      const result = status.body.toString();
      //console.log("status ", result);

      console.error("Status: ", findXmlTag(result, "Status")); // eslint-disable-line no-console
      console.error("TotalCount: ", findXmlTag(result, "TotalCount")); // eslint-disable-line no-console
      console.error("ValidCount: ", findXmlTag(result, "ValidCount")); // eslint-disable-line no-console
      console.error("InvalidCount: ", findXmlTag(result, "InvalidCount")); // eslint-disable-line no-console
      console.log(
        `\nOnce status is completed, run:
                 node plex-geo.js --set ${gid} `
      ); // eslint-disable-line no-console
    })
    .catch((err) => {
      console.error("Error checking batch job", err.message);
    });
}



// array of {latlng: "lat,lng" ,ids: [rec.mid],file}  where mid =  media_items.metadata_item_id
let ForRGC = [];

// array of mids 
let NoRGC = [];

let loopId;

function consoleSameLine(txt) {
  process.stdout.clearLine();  // clear current text
  process.stdout.cursorTo(0);
  process.stdout.write(txt);
}

/**
 * look for GPS coordinate in the image, adnd mark for RGC or no RGC
 * RGC : add in ForRGC
 * No RGC : add in NoRGC
 * @param {*} rec 
 * @returns a promise with 1 if new RGC to do, 0 otherwise
 */
function markForRGC(rec) {
  //console.log("markForRGC ", rec);

  return exif.analyze(rec.file).then(tags => {
    if (tags.pos == null) {
      NoRGC.push(rec.mid); // to be updated with no position
      return { add: 0, id: loopId };
    }
    const elt = ForRGC.find(n => n.latlng == tags.pos.latlng);  // check if we have it already in the latlng ot process
    if (elt) { //we have the location already in the table TheRGC, no need to rgc again
      elt.mids.push(rec.mid); // add the media_item_id of table media_items
      return { add: 0, id: loopId };
    }
    else {
      ForRGC.push({
        latlng: tags.pos.latlng,
        mids: [rec.mid],
        file: rec.file,
      });
      return { add: 1, id: loopId };
    }
  })
    .catch(console.error);
}

/**
 * Go through all Images to see which one to RGC
 * @returns 
 */
async function scanForRGC() {

  let recs = plex.listPhotosPatched();
  console.log("Total photos under review", recs.length, "\n");
  if (recs.length == 0) return;

  // go through all images 
  let promises = [];
  let count = 0; //how many RGc to do have we received
  let stop = false;
  let promisesProcessed = 0;
  loopId = 0;
  do {
    if (stop) {
      console.log();
      console.log("we have reached the maximum queue size. Iterate on the same process to complete");
      break;
    }
    const rec = recs[loopId];
    if (!rec.PlaceUpdateTime) rec.PlaceUpdateTime = 0; // no update time
    const datePlaceUpdate = Date.parse(rec.PlaceUpdateTime);

    consoleSameLine(`${loopId + 1}/${recs.length} scanned, Queuing: ${promisesProcessed}/${promises.length}, ${count} ForRGC / ${NoRGC.length} NoRGC`);

    // what is update time of the file ?
    const stat = await fsPromises.stat(rec.file);
    if (stat.mtimeMs > datePlaceUpdate) { // file most recent than last Place Update
      //console.log(`${count} for RGC / ${i} scanned ${rec.file} fresher than PlaceUpdate `, stat.mtimeMs, datePlaceUpdate);
      consoleSameLine(`${loopId + 1}/${recs.length} scanned, Queuing: ${promisesProcessed}/${promises.length}, ${count} ForRGC / ${NoRGC.length} NoRGC`);
      const p = markForRGC(rec);
      promises.push(p);
      if (promises.length >= MAX_QUEUE) stop = true;

      p.then(elt => {
        count += elt.add;
        promisesProcessed++;
        consoleSameLine(`${elt.id + 1}/${recs.length} scanned, Queuing: ${promisesProcessed}/${promises.length}, ${count} ForRGC / ${NoRGC.length} NoRGC`);
      });
    }
  } while (loopId++ < recs.length - 1);


  //wait for all promises
  await Promise.all(promises);
  console.log();
  console.log(`Ending exif engine`);
  exif.end(); // we terminate the exif engine

  console.log(`ForRGC`, ForRGC.length);
  console.log(`NoRGC`, NoRGC.length);
  //return;

  plex.markImagesAsUpdated(NoRGC, ["PLACE"]);

  // we are good to run the batch RGC
  runBatchGC();

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


if (argv.h || argv.help) {
  console.log(usage); // eslint-disable-line no-console
  process.exit(0);
}

if (argv.check) checkResultAvailable(argv.check);


if (argv.list) {
  plex.init();
  const resp = plex.listFancyPlaces();
  plex.end();
  console.log(resp);
}

async function deleteAllPlaces() {
  const ok = await yesno({
    question: 'Are you sure you want to delete ALL places in the Plex database ?'
  });
  if (!ok) return;
  plexPlaces.deleteAllPlaces();
}
if (argv.delete) deleteAllPlaces();



if (argv.rgc) {
  plex.init();
  scanForRGC();
  plex.end();

}

if (argv.set) addPlaces(argv.set);

