"use strict";
require("dotenv").config();
const debug = require("debug")("Plex");
require("colors");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const csv = require("csvtojson");
const dayjs = require("dayjs");
const log = require("@devbab/logger").child({ label: "Plex" });

const PLEXLIB =
    process.env.PLEXLIB ||
    path.join(
        process.env.LOCALAPPDATA,
        "Plex Media Server/Plug-in Support/Databases/com.plexapp.plugins.library.db"
    );

const PLEX_MEDIA_PATH =
    process.env.PLEXMEDIA ||
    path.join(process.env.LOCALAPPDATA, "Plex Media Server/Media/localhost");


const PLEXMEDIASERVER =
    process.env.PLEXMEDIASERVER || "C:\\Program Files (x86)\\Plex\\Plex Media Server\\Plex Media Server.exe";


const PHOTO_EXT = "('jpeg','png','raw')";

const MAXLENSQL = 5000;


/*
 FACE : in table tags, tag_type 0 && extra_data = FACE
 PLACE : in table tags, tag_type 4000 && extra_data = PLACE

*/
/** Plex Media Server commands
 * -append              append the database to the end of the file
   -ascii               set output mode to 'ascii'
   -bail                stop after hitting an error
   -batch               force batch I/O
   -box                 set output mode to 'box'
   -column              set output mode to 'column'
   -cmd COMMAND         run "COMMAND" before reading stdin
   -csv                 set output mode to 'csv'
   -echo                print commands before execution
   -init FILENAME       read/process named file
   -[no]header          turn headers on or off
   -help                show this message
   -html                set output mode to HTML
   -interactive         force interactive I/O
   -json                set output mode to 'json'
   -line                set output mode to 'line'
   -list                set output mode to 'list'
   -lookaside SIZE N    use N entries of SZ bytes for lookaside memory
   -markdown            set output mode to 'markdown'
   -memtrace            trace all memory allocations and deallocations
   -mmap N              default mmap size set to N
   -newline SEP         set output row separator. Default: '\n'
   -nofollow            refuse to open symbolic links to database files
   -nullvalue TEXT      set text string for NULL values. Default ''
   -pagecache SIZE N    use N slots of SZ bytes each for page cache memory
   -quote               set output mode to 'quote'
   -readonly            open the database read-only
   -separator SEP       set output column separator. Default: '|'
   -stats               print memory stats before each finalize
   -table               set output mode to 'table'
   -tabs                set output mode to 'tabs'
   -version             show SQLite version
   -vfs NAME            use NAME as the default VFS
 */


let db = null;

function init() {
    //debug("plex.init");

    if (!fs.existsSync(PLEXLIB)) {
        console.error(`ERROR: ${PLEXLIB} does not EXIST`.red);
        process.exit(1);
    }

    // open the database
    db = new Database(PLEXLIB, {
        //       verbose: console.log,
        fileMustExist: true,
    });
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    return db;
}

/**
 * close connection to db
 */
function end() {
    db.close();
    //debug("plex.end");
}

function patch() {
    let sql, stmt;
    sql = 'ALTER TABLE media_items ADD COLUMN "Face_updated_at" datetime';
    try {
        stmt = db.prepare(sql);
        stmt.run();
    }
    catch (e) {
        console.error(e);
    }

    sql = 'ALTER TABLE media_items ADD COLUMN "Place_updated_at" datetime';
    try {
        stmt = db.prepare(sql);
        stmt.run();
    }
    catch (e) {
        console.error(e);
    }
}

function listSections() {
    let sql = "SELECT id,name, section_type FROM library_sections";
    let stmt = db.prepare(sql);
    return stmt.all();
}



/**
 * List all photos & thumbnails
 * @returns
 */
function listPhotosThumbs(file = null) {

    let sql = `SELECT MP.file as file,MP.updated_at as updated_at, LS.name as section, MDI.user_thumb_url as thumb_url `;
    sql += `FROM media_parts as MP, media_items as MI, metadata_items as MDI, library_sections as LS `;
    sql += `WHERE MP.media_item_id = MI.id AND MI.metadata_item_id = MDI.id `;
    sql += `AND MI.library_section_id in (SELECT id FROM library_sections where section_type = 13) `;
    sql += `AND LS.id = MI.library_section_id `;
    sql += `AND MI.container in ${PHOTO_EXT} `;
    if (file) sql += `AND MP.file = '${file}' `;

    debug("listPhotosThumbs", sql);

    const stmt = db.prepare(sql);
    let req = stmt.all();

    req = req.map((elt) => {
        elt.file = path.normalize(elt.file);
        elt.thumb_url = path.normalize(PLEX_MEDIA_PATH + elt.thumb_url.substr(7));

        return elt;
    });

    return req;
}

/**
 * List all photos & thumbnails
 * @returns
 */
function listPhotos(file) {

    let sql = `SELECT A.file as file,MDI.user_thumb_url as thumb_url `;
    sql += `FROM media_parts as A, media_items as MI, metadata_items as MDI `;
    sql += `WHERE A.media_item_id = MI.id AND MI.metadata_item_id = MDI.id   `;
    sql += `AND MI.library_section_id in (SELECT id FROM library_sections where section_type = 13) `;
    if (file)
        sql += `AND A.file = '${file}'`

    //debug("listPhotos", sql);


    const stmt = db.prepare(sql);
    let req = stmt.all();

    req = req.map((elt) => {
        return {
            file: path.normalize(elt.file),
            thumb_url: path.normalize(PLEX_MEDIA_PATH + elt.thumb_url.substr(7)),
        };
    });

    return req;
}

/**
 * List all photos & thumbnails
 * @returns {array} array of {file,mid,FaceUpdateTime, PlaceUpdateTime}
 */
function listPhotosPatched() {

    let sql = `SELECT MP.file as file,MI.metadata_item_id as mid, MI.Face_updated_at as FaceUpdateTime, MI.Place_updated_at as PlaceUpdateTime `;
    sql += `FROM media_parts as MP, media_items as MI `;
    sql += `WHERE MP.media_item_id = MI.id `;
    sql += `AND MI.library_section_id in (SELECT id FROM library_sections where section_type = 13)`;
    sql += `AND MI.container in ${PHOTO_EXT} `;

    const stmt = db.prepare(sql);
    let req = stmt.all();

    req = req.map((elt) => {
        elt.file = path.normalize(elt.file)
        return elt;
    });

    return req;
}



/**
 * run a SQL command thourgh Plex Media Server
 * NOTE it seems like there a limit in number of results, between 10K and 20K
 * 
 * @param {*} sql 
 * @returns {Object] json answer
 */
async function run(sql) {

    /*   let fileOut = path.normalize(`${TMP}/${uniqid.time()}.sql`);
       debug("temp file", fileOut);
   
       const buffer =
           `.echo off
       .header on
       .open ${PLEXLIB}
       .output
       ${sql}`;
   
       await fsPromises.writeFile(fileOut, buffer).catch(console.error);

    //fileOut = path.normalize("c:\\temp\\test.sql");
    */
    // mode -json does not work well
    const command = `"${PLEXMEDIASERVER}" --sqlite -header "${PLEXLIB}"  "${sql}"`;
    //const command = `"${PLEXSQL}" -init "${fileOut}"  "${PLEXLIB}"  .quit`;
    log.debug("Plex.run command", command);

    return new Promise((resolve, reject) => {
        exec(command, (err, stdout, stderr) => {
            if (err) {
                //some err occurred
                console.error("Plex.run Stderr", stderr.red);
                reject(stderr);
            } else {
                //debug("Stdout:", stdout);
                //resolve(stdout);

                csv({
                    noheader: false,
                    delimiter: "|",
                    trim: true
                })
                    .fromString(stdout)
                    .then((json) => { resolve(json); });
            }
        });
    });
}


/**
 * run a big SQL command by joining mulitple lines of list until the SQL queries reaches a maxlen.
 * joining is done with "",""
 * 
 * @param {array} list   list of entries to add
 * @param {string} sqlIntro   list of initial SQL bit, for instance "INSERT INTO tags (tag, tag_type, extra_data) VALUES  "
 * @param {function} buildEntry  function called as buildEntry(elt) and returns the sql line to add
 * @returns void
 */
async function runBig(list, sqlIntro, buildEntry) {

    if (!list?.length) return;

    let newbit = [];
    // take each elent to add, check if not too long and send to run if adding next one makes it too long 
    while (list.length > 0) {

        //const entry = `('${list[0]}',0,'FACE')`;
        const entry = buildEntry(list[0]);
        const newlen = sqlIntro.length + newbit.join(",").length + entry.length + 1; // +1 for comma

        // debug(`addFaces current diff,newbit, len`, diff, newbit, newlen);

        if (newlen < MAXLENSQL) { // this will fit, add in the newbit
            newbit.push(entry);
            list.shift(); // command not run, we consider the next one
        }

        // command too long or nothing anymore to add
        if (newlen > MAXLENSQL || list.length == 0) {
            const sql = sqlIntro + newbit.join(",");
            log.debug(`plex.runBig sends sql`, sql);
            await run(sql).catch((err) => { console.error("plex.runBig error", err); });
            newbit = [];
        }
    }

}



/**
 * details main info of a file
 * @param {string} imageFile - name of the image file 
 * @returns {string} - description
 */
function listTagsForImage(imageFile, type, fancy = false) {

    let tag_type;

    switch (type) {
        case 'PLACE': tag_type = 400; break;
        case 'FACE': tag_type = 0; break;
        default: throw `plex.listTags: wrong type ${type}`
    }

    let sql = `SELECT T.tag, T.id, TG."index"   `;
    sql += `from media_parts as MP, media_items as MI, taggings as TG, tags as T `;
    sql += `WHERE MP.file = '${imageFile}' AND MP.media_item_id = MI.id AND MI.metadata_item_id = TG.metadata_item_id AND TG.tag_id = T.id `;
    sql += `AND T.tag_type = ${tag_type}`;

    const stmt = db.prepare(sql);
    let resp = stmt.all();

    if (fancy && type == "PLACE") { // clarifiy districty, city etc
        resp = resp.map(elt => {
            switch (elt.index) {
                case 0: elt.place_level = "country"; break;
                case 1: elt.place_level = "district/urban area"; break;
                case 2: elt.place_level = "county/region"; break;
                case 3: elt.place_level = "city"; break;
                case 4: elt.place_level = "Street/poi"; break;
                default: elt.place_level = "unknown"; break;
            }
            return elt;
        });
    }
    return resp;
}

function findFile(options) {
    log.info(`findFile`, options);

    if (!options?.file && !options?.mid) return;

    //m id = media_items.metadata_item_id
    // media_items.metadata_item_id

    let sql = `SELECT MP.file,MI.metadata_item_id as mid,Place_updated_at, Face_updated_at  `;
    sql += `from media_parts as MP, media_items as MI `;
    sql += `WHERE  MP.media_item_id = MI.id  `;
    if (options?.file) sql += `AND MP.file like '${options.file}' `;
    if (options?.mid) sql += `AND MI.metadata_item_id =  ${options.mid} `;

    debug(`findFile SQL ${sql}`);


    const stmt = db.prepare(sql);
    return stmt.all();
}

function details(options) {
    log.info(`details`, options);

    if (!options?.file && !options?.mid) return;

    let resp = findFile(options);
    if (resp.length == 0) return {};

    let output = {
        file: resp[0].file,
        mid: resp[0].mid,
        Place_updated_at: resp[0].Place_updated_at,
        Face_updated_at: resp[0].Face_updated_at
    }

    //m id = media_items.metadata_item_id

    // looking for some tags
    let sql = `SELECT TG.id, TG.tag_id as tag_id, TG."index", T.tag_type, T.tag_value,T.tag,T.extra_data   `;
    sql += `from media_parts as MP, media_items as MI, taggings as TG, tags as T `;
    sql += `WHERE  MP.media_item_id = MI.id AND MI.metadata_item_id = TG.metadata_item_id AND TG.tag_id = T.id `;
    sql += `AND T.tag_type in (0,400) `;
    sql += `AND MI.metadata_item_id =  ${resp[0].mid} `;

    sql += `ORDER by T.tag ASC`;
    debug(`details Tag SQL ${sql}`);


    const stmt = db.prepare(sql);
    resp = stmt.all();
    if (resp.length == 0) return output; // no tags, answer with what we have


    output.FACES = resp.filter(elt => elt.extra_data == "FACE").map(elt => {
        return {
            taggings: `id: ${elt.id}, tag_id: ${elt.tag_id}`,
            tag: `tag: "${elt.tag}", index: ${elt.index}`
        }
    });
    output.PLACES = resp.filter(elt => elt.extra_data == "PLACE").map(elt => {
        return {
            taggings: `id: ${elt.id}, tag_id: ${elt.tag_id}`,
            tag: `tag: "${elt.tag}", index: ${elt.index}, tag_value:${elt.tag_value}`
        }
    });


    return output;
    /*
        resp = resp.map(elt => {
            switch (elt.index) {
                case 0: elt.place_level = "country"; break;
                case 1: elt.place_level = "district/urban area"; break;
                case 2: elt.place_level = "county/region"; break;
                case 3: elt.place_level = "city"; break;
                case 4: elt.place_level = "Street/poi"; break;
                default: elt.place_level = "unknown"; break;
            }
            return elt;
        });
    
        return resp;
    */
}



/**
 * delete all tags for a file
 * This means delete entries in taggings and NOT in tags as they might be used elsewhere
 * @param {string} imageFile name of the image file 
 * @param {string} type : "PLACE", "FACE"
 * @returns : promise to delete SQL query
 */
function deleteTagsForImage(imageFile, type) {

    let sql, tag_type;

    switch (type) {
        case 'PLACE': tag_type = 400; break;
        case 'FACE': tag_type = 0; break;
        default: throw `plex.listTags: wrong type ${type}`
    }

    // find the entry of concern
    sql = `SELECT TG.id, TG.extra_data  `;
    sql += `from media_parts as MP, media_items as MI, taggings as TG, tags as T `;
    sql += `WHERE MP.file = '${imageFile}' AND MP.media_item_id = MI.id AND MI.metadata_item_id = TG.metadata_item_id AND TG.tag_id = T.id `;
    sql += `AND T.tag_type = ${tag_type}`;

    const stmt = db.prepare(sql);
    let resp = stmt.all();


    if (resp.length == 0)
        return Promise.reject(`no tags to delete`);

    debug(`Removing ${resp.length} entries`);

    const ids = resp.map(resp => resp.id).join(",");
    sql = `DELETE from taggings where id in (${ids})`;
    debug(`SQL`, sql);
    return run(sql);
}




/**
 * returns all Taggings entries which concerns us
 * eg index in (0,1,2,3,4). 0 = user tag, (0...4 ) = place tags
 * @params {string} type = FACE or PLACE
 * @returns 
 */
function listTagging(type = null) {
    let sql = `select id,metadata_item_id as mid,tag_id,"index" from taggings `;
    sql += `WHERE "index" in (0,1,2,3,4) `;
    if (type) sql += `AND extra_data = '${type}'`;
    sql += `ORDER by metadata_item_id, tag_id ASC `;

    log.debug(`listTagging SQL`, sql);
    const stmt = db.prepare(sql);
    return stmt.all();
}

/**
 * returns all Faces, eg list of entries in tags where extra_data = 'FACE'
 * @param {array} names array of names to which to restrict the search 

 * @returns 
 */
function listFaces(names = null) {
    let sql = `SELECT T.id, T.tag   from tags as T WHERE   T.extra_data ='FACE' `;


    if (names?.length > 0) {
        const list = names.map(elt => {
            elt = elt.replace(/'/g, "''"); // replace any potential quote by quote uote
            return `'${elt}'`;
        }).join(",");

        sql += `AND T.Tag in (${list}) `; // [A,B] => 'A','B'
    }
    sql += `ORDER by T.tag ASC`;

    log.debug(`listFaces SQL:`, sql);

    const stmt = db.prepare(sql);
    return stmt.all();
}


/**
 * returns all Places, eg list of entries in tags where extra_data = 'PLACE'
 * @param {array} names array of names to which to restrict the search 

 * @returns array of {id,tag,index}
 */
function listPlaces(names = null) {
    let sql = `SELECT T.id, T.tag, T.tag_value  from tags as T WHERE  T.extra_data ='PLACE' `;


    if (names?.length > 0) {
        const list = names.map(elt => {
            elt = elt.replace(/'/g, "''"); // replace any potential quote by quote uote
            return `'${elt}'`;
        }).join(",");
        sql += `AND T.Tag in (${list}) `; // [A,B] => 'A','B'
    }
    sql += `ORDER by T.tag ASC`;


    log.debug(`listPlaces SQL:`, sql);

    const stmt = db.prepare(sql);
    return stmt.all();
}


/**
 * return list of Places with level info
 * @param {*} name 
 * @returns 
 */
function listFancyPlaces(name = null) {
    const resp = listPlaces(name);

    return resp.map(elt => {
        switch (elt.tag_value) {
            case 10: elt.level = "Country"; break;
            case 40: elt.level = "District/urban area"; break;
            case 20: elt.level = "County/region"; break;
            case 30: elt.level = "City"; break;
            case 50: elt.level = "Street/POI"; break;
        }
        return elt;
    });

}


/**
 *  
 * @param {array} mids  - array of mid , where mid = field metadata_item_id in table media_items
 * @param {array} type  - one or two of ["PLACE","FACE"]
 * 
 *  @return void
 * 
 */
async function markImagesAsUpdated(mids, type) {
    //debug(`markImagesAsUpdated #mid:  ${mids.length}`, type);
    log.debug(`markImagesAsUpdated #mid:  ${mids.length}`, type);

    if (!mids.length) return;
    if (!type?.length) return;

    let newbit = [];
    const now = new dayjs().format("YYYY-MM-DD HH:mm:ss");

    let fields = [];
    if (type.includes("FACE")) fields.push(`Face_updated_at = '${now}'`);
    if (type.includes("PLACE")) fields.push(`Place_updated_at = '${now}'`);


    // take each element to add, check if not too long and send to run if adding next one makes it too long 
    while (mids.length > 0) {

        const entry = "" + mids[0]; // converted in string to get a valid entry.length
        const sql = `UPDATE  media_items SET ${fields.join(",")} where media_items.metadata_item_id in (${newbit.join(",")})`;

        const newlen = sql.length + entry.length + 1; // +1 for comma


        if (newlen < MAXLENSQL) { // this will fit, add in the newbit
            newbit.push(entry);
            mids.shift(); // command not run, we consider the next one
        }

        // command too long or nothing anymore to add
        if (newlen > MAXLENSQL || mids.length == 0) {
            const sql = `UPDATE  media_items SET ${fields.join(",")} where media_items.metadata_item_id in (${newbit.join(",")})`;
            log.verbose(`markImagesAsUpdated sends sql`, sql);
            await run(sql).catch((err) => { console.error("plex.runBig error", err); });
            newbit = [];
        }
    }

}

function whichDB() {
    return PLEXLIB;
}


/**
 *  delete FACES NOT
 */
function clean() {
    log.verbose(`clean`);
    //select * from tags as T, taggings as TG where TG.metadata_item_id =  418670 and TG.tag_id = T.id
    //  file: 'D:\\Photos Malgosia\\360 FRANCE JULY 2016\\20160703 FETE JANEM\\Janem MA_084562.JPG',
    //mid: 418670,
    let sql;

    //sql = `ALTER TABLE media_items DROP COLUMN 'TTP_updated_at'`;
    // remove tags not referenced in taggings
    sql = `DELETE from taggings where tag_id not in (select id from tags) `;

    log.debug(`Clean SQL`, sql);
    run(sql);

    // remove tags not referenced in taggings
    sql = `DELETE from tags where id not in (select tag_id from taggings) AND extra_data = 'FACE' `;
    log.debug(`Clean SQL`, sql);
    run(sql);


}

module.exports = {
    whichDB,
    init,
    end,
    patch,
    clean,
    run,
    runBig,

    listSections,

    findFile,
    details,

    // generic about tagging of photo, place
    listTagsForImage,
    deleteTagsForImage,
    listFaces,
    listPlaces,
    listFancyPlaces,

    listTagging,

    listPhotos,
    listPhotosThumbs,
    listPhotosPatched,       // list of photos, with PLACE, TTP update fields

    markImagesAsUpdated
};