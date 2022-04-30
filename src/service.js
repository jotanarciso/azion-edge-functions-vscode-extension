// @ts-nocheck
const fetch = require("node-fetch");


const API_STAGE = "https://stage-api.azion.net/edge_functions";
const API_PROD = "https://api.azionapi.net/edge_functions";

const REQ_HEADERS = {
  Accept: "application/json; version=3",
  "Content-Type": "application/json",
};

/**
 * @param { String } TOKEN
 */
async function get(TOKEN, URL) {
  return fetch(URL ? URL : API, {
    method: "GET",
    headers: {
      Authorization: `Token ${TOKEN}`,
      ...REQ_HEADERS,
    },
  })
    .then((res) => res.json())
    .then((body) => body);
}

/**
 * @param { String } TOKEN
 * @param { Number } functionId
 * @param { Object } payload
 */

async function patch(TOKEN, functionId, payload) {
  return fetch(`${API}/${functionId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    redirect: "follow",
    headers: {
      Authorization: `Token ${TOKEN}`,
      ...REQ_HEADERS,
    },
  })
    .then((res) => res.json())
    .then((body) => body);
}

async function post(TOKEN, payload) {
  return fetch(API_PROD, {
    method: "POST",
    body: JSON.stringify(payload),
    redirect: "follow",
    headers: {
      Authorization: `Token ${TOKEN}`,
      ...REQ_HEADERS,
    },
  })
    .then((res) => res.json())
    .then((body) => body);
}

module.exports = { get, post, patch };
