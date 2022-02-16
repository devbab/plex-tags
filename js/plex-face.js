"use strict";
const debug = require("debug")("Face");
const _ = require("lodash");
const plex = require("./plex.js");
const dayjs = require("dayjs");
const log = require("@devbab/logger").child({ label: "Plex-face" });



/**
 * return a list of unique names, quote escaped
 * @param {Object} tags array of {mids,faces:[name,name]}
 * @returns {array} array of names
 */
function uniqueNames(tags) {
    // got unique list of faces and escape potential quote
    let names = tags.map(elt => elt.faces);
    names = _.flatten(names);
    names = _.uniq(names);
    names = _.compact(names); // remove falsey
    return names.map(face => face.replace(/'/g, "''")).sort();
}


/**
 * list all existing faces and add the new ones which do not exist yet
 * @param {Object} tags array of {mid,faces:[name,name]}
 */
async function addFacesinTags(names) {
    debug(`addFacesinTags`);


    // get list of existing whitin the potential new
    plex.init();
    let existingFaces = plex.listFaces(names);
    existingFaces = existingFaces.map(elt => elt.tag);
    plex.end();

    //    console.log("Existing", existingFaces);
    //    console.log("New Faces", names);

    let add = _.difference(names, existingFaces);
    log.debug("Faces to add", add);


    // creates all the new faces
    const now = new dayjs().format("YYYY-MM-DD HH:mm:ss");

    const sqlIntro = "INSERT INTO tags (tag, created_at,updated_at,tag_type, extra_tag) VALUES  ";
    await plex.runBig(add, sqlIntro, (elt) => {
        return `('${elt}','${now}','${now}',0,'FACE')`;
    });

}


/**
 * add the tags to the corresponding mid in table taggings  
 * mid = field metadata_item_id in table media_items
 @param {Object} tags array of {mid,faces:[name,name]}
 */
async function addSubFacesInTaggings(names, tags) {
    log.debug(`addFacesInTaggings`, tags);


    //build list of existing links = [mid,tag_id]. tag_id is id in tags
    plex.init();
    let existingFaces = plex.listFaces(names); // list of {id,tag} where tag = name of the face

    // list of existing
    let existingLinks = plex.listTagging("FACE"); // array of {mid,tag_id,index}
    plex.end();

    // keeps in existing links the ones related to the mid in tags : the images where there are changes
    const midsToChange = tags.map(tag => tag.mid);
    existingLinks = existingLinks.filter(elt => { return midsToChange.includes(elt.mid); })
    //console.log(`midsToChange ${midsToChange}`);
    //console.log(`existingLinks ${existingLinks}`);

    // lets build list of  links to add, we'll remove after those already existing
    // array of  {mid,tag_id}
    let newLinks = [];

    //    let's build the list to create
    tags.forEach((tag) => {
        //console.log("working on tag", tag);
        tag.faces.forEach(face => {
            const found = existingFaces.find(elt => elt.tag == face);
            if (!found) return console.error(`ERROR: addFacesInTaggings, cannot find entry for face ${face}`);
            //console.log(`${face} = ${found.id}`);
            newLinks.push({ mid: tag.mid, tag_id: found.id });
        });
    });


    // here we have a list of [mid, tag_id]
    // console.log("new links ", newLinks);
    let add = _.differenceBy(newLinks, existingLinks, (elt) => { return `${elt.mid}-${elt.tag_id}}`; });
    add = _.uniqBy(add, (elt) => { return `${elt.mid}-${elt.tag_id}}`; });
    log.debug("Taggings links to Add", add);

    // what to remove  = existing links not in new ones.
    let sub = _.differenceBy(existingLinks, newLinks, (elt) => { return `${elt.mid}-${elt.tag_id}}`; });
    sub = _.uniqBy(sub, (elt) => { return `${elt.mid}-${elt.tag_id}}`; }); // remove duplicates but there should not be any
    log.debug("Taggings links to remove", sub);

    /*
    const trackMid = 13;
    console.log("TRACK existing Links", existingLinks.filter(elt => elt.mid == trackMid));
    console.log("TRACK new Links", newLinks.filter(elt => elt.mid == trackMid));
    console.log("TRACK Taggings links to Add", add.filter(elt => elt.mid == trackMid));
    console.log("TRACK Taggings links to remove", sub);
*/


    // creates all the new links
    if (add.length > 0) {
        const now = new dayjs().format("YYYY-MM-DD HH:mm:ss");
        const sqlIntro = "INSERT INTO taggings (metadata_item_id, tag_id,'index', created_at, extra_tag) VALUES  "
        await plex.runBig(add, sqlIntro, (elt) => { return `('${elt.mid}','${elt.tag_id}',0,'${now}','FACE')`; });
    }

    if (sub.length > 0) {
        const ids = sub.map(elt => elt.id).join(",");
        // remove all the past links not needed anymore
        const sql = `DELETE FROM taggings WHERE id in (${ids})`;
        log.debug(`remove taggings SQL `, sql);
        await plex.run(sql);
    }
}




/**
 * Add faces in database = add whatever is new in table tags, and does the linking in table tagging
 * plus mark the images as updated
 * @param {Object} tags array of {mid,faces:[name,name]} 
 */
async function addFaces(tags) {
    if (!tags?.length) return; // nothing to update

    log.debug(`addFaces ${tags.length} tags`);
    let names = uniqueNames(tags);

    await addFacesinTags(names);
    // substract previous refer
    await addSubFacesInTaggings(names, tags);

    // mark the image as updateds
    const mids = tags.map(elt => elt.mid);
    await plex.markImagesAsUpdated(mids, ["FACE"]);
}


/**
 * delete all Face
 * This means delete entries in  tags where tag_type = 0 && extra_tag='FACE'  AND delete entries in tagging where tag_id does not exists anymore
 * @returns : promise to delete SQL query
 */
function deleteAllFaces() {

    let sql;
    // find the entry of concern
    sql = `DELETE from tags where tag_type == 0 AND extra_tag = 'FACE'  `;
    plex.run(sql);

    // wider clean of whatever tagging which is not found in tag
    sql = `DELETE from taggings where tag_id not in (select id from tags) `;
    plex.run(sql);

}

module.exports = {
    addFaces,
    deleteAllFaces

}


