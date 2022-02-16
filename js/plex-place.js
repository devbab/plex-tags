const _ = require("lodash");
const plex = require("./plex.js");
const debug = require("debug")("Place");
const dayjs = require("dayjs");
const log = require("@devbab/logger").child({ label: "Plex-place" });

const COUNTRY_VALUE = 10;
const REGION_VALUE = 20; // County
const CITY_VALUE = 30;
const DISTRICT_VALUE = 40; // Urban Area
//const STREET_VALUE = 50; // Street POI


/**
 * 
 * @param {Object} tags array of {country,county,city,district}
 */
async function addPlacesinTags(tags) {
    log.debug(`addPlacesinTags`);

    plex.init();
    const existing = plex.listPlaces();
    plex.end();


    let newTags = [];

    tags.forEach(rec => {

        if (rec.country)
            newTags.push({
                tag: rec.country,
                tag_value: COUNTRY_VALUE,
            });
        if (rec.city)
            newTags.push({
                tag: rec.city,
                tag_value: CITY_VALUE,
            });
        if (rec.county)
            newTags.push({
                tag: rec.county,
                tag_value: REGION_VALUE,
            });
        if (rec.district)
            newTags.push({
                tag: rec.district,
                tag_value: DISTRICT_VALUE,
            });

    })
    //console.log("Existing", existing);
    //console.log("New Tags", newTags);

    let diff = _.differenceBy(newTags, existing, (elt) => {
        return `${elt.tag}${elt.tag_value}`;
    });
    // remove duplicates
    diff = _.uniqBy(diff, (elt) => {
        return `${elt.tag}${elt.tag_value}`;
    });
    log.info("New Places to add", diff);


    // do we have PLACE tags to add ?
    if (diff.length > 0) {

        let sql = [];
        diff.forEach((elt) => {
            const tag = elt.tag.replace(/'/g, "''"); // escape potential '
            sql.push(`('${tag}',400,${elt.tag_value},'PLACE')`);
        });

        // Add into Tags table
        sql =
            "INSERT INTO tags (tag, tag_type,tag_value, extra_tag) VALUES  " +
            sql.join(",");
        log.debug("\nAdd Places SQL length ", sql.length);
        await plex.run(sql).catch((err) => {
            console.error("addNewplacesinTags/plex.run error", err.red);
        });
    }
}


/**
 * add the tags to the corresponding mid in table taggings  
 * mid = field metadata_item_id in table media_items
 * @param {array} midsArray  array of mid,mid,mid, same order as in tags, tags.recId contains the index nto mids
 * @param {array} tags   array of {recId = mid, city,county,district,country}
 */
async function addPlacesInTaggings(midsArray, tags) {
    log.debug(`addPlacesInTaggings`, midsArray, tags.filter(elt => elt.recId == 4));

    plex.init();
    const existingTaggings = plex.listTagging(); // {mid,tag_id,index}
    const existingPlaces = plex.listPlaces(); // {id,tag,tag_value}
    plex.end();

    debug("existing places", existingPlaces);
    debug("existing taggings 23", existingTaggings.filter(elt => elt.mid == 23));

    let newLinks = [];
    //    let's build the list to create
    tags.forEach((tag) => {

        if (tag.recId >= midsArray.length) {
            console.error("MAYDAY we have an error in index ", tag.recId, midsArray.length)
            return;
        }
        const mids = midsArray[tag.recId].split(",");

        const city = tag.city;
        const cityId = existingPlaces.find(elt => { return elt.tag == city && elt.tag_value == CITY_VALUE })?.id;
        const county = tag.county;
        const countyId = existingPlaces.find(elt => { return elt.tag == county && elt.tag_value == REGION_VALUE })?.id;
        const district = tag.district;
        const districtId = existingPlaces.find(elt => { return elt.tag == district && elt.tag_value == DISTRICT_VALUE })?.id;
        const country = tag.country;
        const countryId = existingPlaces.find(elt => { return elt.tag == country && elt.tag_value == COUNTRY_VALUE })?.id;

        //debug(`${mids}:   ${district}: ${districtId},   ${city}: ${cityId},   ${county}: ${countyId},   ${country}: ${countryId}`)

        mids.forEach(mid => {
            if (cityId) newLinks.push({ mid, tag_id: cityId, index: 3 });
            if (countyId) newLinks.push({ mid, tag_id: countyId, index: 2 });
            if (districtId) newLinks.push({ mid, tag_id: districtId, index: 1 });
            if (countryId) newLinks.push({ mid, tag_id: countryId, index: 0 });

        });
    });


    // console.log("new links ", newLinks);
    let diff = _.differenceBy(newLinks, existingTaggings, (elt) => {
        return `${elt.mid}-${elt.tag_id}}`;
    });
    // remove duplicates but there should not be any
    diff = _.uniqBy(diff, (elt) => {
        return `${elt.mid}-${elt.tag_id}}`;
    });
    log.debug("Place links to Add ", diff);


    const now = new dayjs().format("YYYY-MM-DD HH:mm:ss");

    const sqlIntro = "INSERT INTO taggings (metadata_item_id, tag_id,'index', created_at, extra_tag) VALUES";
    await plex.runBig(diff, sqlIntro, (elt) => {
        return `('${elt.mid}',${elt.tag_id},${elt.index},'${now}','PLACE')`;
    });

}



/**
 * Add faces in database = add whatever is new in table tags, and does the linking in table tagging
 * @param {Object} tags array of {mid,faces:[name,name]} 
 */
async function addPlaces(mids, tags) {
    debug(`addPlaces`);
    await addPlacesinTags(tags);
    await addPlacesInTaggings(mids, tags);
}


/**
 * delete all Places
 * This means delete entries in  tags where tag_type = 400  & extra_tag = 'PLACE' AND delete entries in tagging where tag_id does not exists anymore
 * @returns : promise to delete SQL query
 */
function deleteAllPlaces() {

    let sql;
    // find the entry of concern
    sql = `DELETE from tags where tag_type == 400 AND extra_tag = 'PLACE'  `;
    plex.run(sql);

    sql = `DELETE from taggings where tag_id not in (select id from tags) `;
    plex.run(sql);
}



module.exports = {
    addPlaces,
    deleteAllPlaces

}


