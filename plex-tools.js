const argv = require("minimist")(process.argv.slice(2));
const plex = require("./js/plex.js");
const plexFace = require("./js/plex-face.js");
const plexPlace = require("./js/plex-place.js");
const yesno = require("yesno");
const exif = require("./js/exif.js");
require("colors");
const log = require("@devbab/logger").child({ label: "Plex-tools" });
if (process.env.logger) log.setLevel(process.env.logger);

const usage = `node plex-tools.js
    --patch:        patch the database. DO A BACKUP BEFORE

    --clean        clean unused PLACE/FACE  in tags

    --allplaces     list all places
    --allfaces      list all faces
    
    --delfaces      delete all FACES
    --delplaces     delete all PLACES

    --thumb <file>  locate thumbnail for a file

    --details -f <file> | -m <mid>  show FACE/PLACE details for a file
    --exif -f <file> | -m <mid>     show EXIF info for a fle
    
    Database in use: ${plex.whichDB()}
s
`;

if (argv.h || argv.help) return console.log(usage);



async function patch() {

    const ok = await yesno({
        question: 'Are you sure you want to continue and patch the Plex database ?'
    });
    if (!ok) return;
    log.info(`Patch`);

    plex.init();
    plex.patch();
    plex.end();
}

if (argv.patch) patch();

if (argv.allplaces) {

    plex.init();
    const resp = plex.listPlaces();
    plex.end();
    console.log();

    let res;
    res = resp.filter(elt => elt.tag_value == 10); console.log(`${res.length} Countries`, res.map(elt => elt.tag).sort());
    res = resp.filter(elt => elt.tag_value == 20); console.log(`${res.length} Regions`, res.map(elt => elt.tag).sort());
    res = resp.filter(elt => elt.tag_value == 30); console.log(`${res.length} Cities`, res.map(elt => elt.tag).sort());
    res = resp.filter(elt => elt.tag_value == 40); console.log(`${res.length} Districts`, res.map(elt => elt.tag).sort());
    res = resp.filter(elt => elt.tag_value == 50); console.log(`${res.length} POIs`, res.map(elt => elt.tag).sort());

}

if (argv.allfaces) {

    plex.init();
    const resp = plex.listFaces();
    plex.end();
    console.log(`${resp.length} Faces`);
    console.log(resp.map(elt => elt.tag).sort());
    console.log();
}



if (argv.thumb) {
    plex.init()
    console.log(`Thumb for Image file: ${argv.thumb}`.green);
    const resp = plex.listPhotosThumbs(argv.thumb);
    console.log(resp);
    plex.end();
    return;
}

if (argv.details) {

    plex.init()
    const resp = plex.details({ file: argv.f, mid: argv.m });
    console.log(resp);
    plex.end();
}


if (argv.clean) {
    plex.clean();
}

if (argv.exif) {

    plex.init()
    const resp = plex.findFile({ file: argv.f, mid: argv.m });
    plex.end();
    console.log(resp);
    exif.raw(resp[0].file).then(tags => {
        console.log(tags);
        exif.end();
    });
}


async function delfaces() {
    const ok = await yesno({
        question: 'Are you sure you want to delete all FACES in Plex database ?'
    });
    if (!ok) return;

    plex.init()
    plexFace.deleteAllFaces();
    plex.end();

}
if (argv.delfaces) delfaces();


async function delplaces() {
    const ok = await yesno({
        question: 'Are you sure you want to delete all PLACES in Plex database ?'
    });
    if (!ok) return;

    plex.init()
    plexPlace.deleteAllPlaces();
    plex.end();

}
if (argv.delplaces) delplaces()

// in release 1.0.4 we had put PLACE ad FACE into extra_data, Plex seems to complain..
if (argv.fix104) {
    let sql;

    sql = `update tags set extra_tag=extra_data where extra_data in ('PLACE','FACE'); `;
    sql += `update tags set extra_data='' where extra_tag in  ('PLACE','FACE') ;`;
    sql += `update taggings set extra_tag=extra_data where extra_data in ('PLACE','FACE'); `;
    sql += `update taggings set extra_data='' where extra_tag in  ('PLACE','FACE') ;`;
    plex.run(sql);

}