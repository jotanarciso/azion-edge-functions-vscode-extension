const {
  workspace,
  window,
  commands,
  // eslint-disable-next-line no-unused-vars
  Uri,
  // eslint-disable-next-line no-unused-vars
  ExtensionContext,
  // eslint-disable-next-line no-unused-vars
  TextDocument,
  // eslint-disable-next-line no-unused-vars
  FileType,
} = require("vscode");

const {
  createFolder,
  createFile,
  createProgress,
  createWorkspace,
  getFileExtension,
  getFunctionNameByPath,
  getPathWithoutFile,
  getFileContent,
  slashUnicode,
} = require("./helper");
const { get, post, patch } = require("./service");
const messages = require("./messages");

const getPath = require("platform-folders").default;
const util = require("util");
const exec = util.promisify(require("child_process").exec);

const USER_DOCUMENTS_PATH = getPath("documents");
const AZION_FOLDER_NAME = "azion-edge-functions";
const AZION_EDGE_FUNCTIONS_PATH = `${USER_DOCUMENTS_PATH}/${AZION_FOLDER_NAME}`;
/**
 * @param {ExtensionContext} context
 */
async function activate(context) {
  context.subscriptions.push(commands.registerCommand("azion-functions.init", () => init(context)));
  context.subscriptions.push(
    commands.registerCommand("azion-functions.update-token", () => updateToken(context))
  );
  context.subscriptions.push(
    commands.registerCommand(
      "azion-functions.patch",
      async () => await updateEdgeFunction(window.activeTextEditor?.document, context)
    )
  );
  context.subscriptions.push(
    commands.registerCommand(
      "azion-functions.create-fla",
      async () => await createFlareactFunction(context)
    )
  );
  context.subscriptions.push(
    commands.registerCommand(
      "azion-functions.build-fla",
      async () => await buildFlareactFunction(context)
    )
  );
  context.subscriptions.push(
    commands.registerCommand(
      "azion-functions.publish-fla",
      async () => await publishFlareactFunction(context)
    )
  );
}

function deactivate() {
  window.showInformationMessage(messages.deactivated);
}

/**
 * @param {ExtensionContext} context
 */
async function init(context) {
  context.globalState.update("FUNCTIONS", []); // reset storage functions
  try {
    const newContext = await setToken(context);
    const TOKEN = await newContext.secrets.get("TOKEN");
    if (TOKEN) {
      const myEdgeFunctions = await getAllEdgeFunctions(newContext);
      await createWorkspace(AZION_EDGE_FUNCTIONS_PATH, AZION_FOLDER_NAME);
      myEdgeFunctions.forEach(async (/** @type {Object} */ foo) => {
        await createProgress(messages.creatingFile(foo.name), createLocalFunction(foo));
      });
    }
  } catch (err) {
    console.error(err);
    window.showErrorMessage(`${err}`);
  }
}

/**
 * @param {ExtensionContext} context
 */
async function setToken(context) {
  const TOKEN = await context.secrets.get("TOKEN");
  if (TOKEN) {
    return context;
  } else {
    const TOKEN = await window.showInputBox({ placeHolder: messages.insertToken });
    await context.secrets.store("TOKEN", TOKEN);
    return context;
  }
}

/**
 * @param {ExtensionContext} context
 */
async function updateToken(context) {
  await context.secrets.delete("TOKEN");
  await setToken(context);
}

/**
 * @param {ExtensionContext} context
 */
async function getAllEdgeFunctions(context) {
  const aux = [];
  const TOKEN = await context.secrets.get("TOKEN");
  const recursion = async (nextPageURL = null) => {
    try {
      const response = await get(TOKEN, nextPageURL);
      if (response.results) {
        const { results } = response;
        aux.push(...results);
        if (response.links.next) {
          recursion(response.links.next);
        }
      } else throw response;
    } catch (err) {
      throw err;
    }
  };

  if (TOKEN) {
    try {
      await createProgress(messages.synchronizing, recursion());
      context.globalState.update("FUNCTIONS", aux);
      return Promise.resolve(aux);
    } catch (err) {
      context.secrets.delete("TOKEN");
      if (err.detail) {
        throw `${messages.azionApiError} ${err.detail}`;
      } else {
        throw `${messages.somethingWrong} ${messages.checkToken}`;
      }
    }
  }
}

/**
 * @param {TextDocument} doc
 * @param {ExtensionContext} context
 */
async function updateEdgeFunction(doc, context) {
  if (doc) {
    const TOKEN = await context.secrets.get("TOKEN");
    const folderName = getFunctionNameByPath(doc.uri.path);
    const payload = {};

    const nameWithSlashUnicode = slashUnicode(folderName, "string");
    const myEdgeFunctions = await context.globalState.get("FUNCTIONS");

    // function to be edited [index]
    const functionIndex = myEdgeFunctions.findIndex(
      (/** @type {{ name: Object; }} */ foo) => foo.name === nameWithSlashUnicode
    );

    const myEdgeFunction = myEdgeFunctions[functionIndex];
    const { name, id, json_args, code } = myEdgeFunction;

    const isCode = () => doc.uri.path.includes("code.js");
    const isArgs = () => doc.uri.path.includes("args.json");

    const newContent = doc.getText();
    const oldCode = code;
    const oldArgs = json_args;

    if (isCode()) payload.code = newContent;
    if (isArgs()) payload.json_args = newContent;

    if ((isCode() && oldCode !== newContent) || (isArgs() && oldArgs !== newContent)) {
      try {
        const updateEdgeFunction = await createProgress(
          messages.updating,
          patch(TOKEN, id, payload)
        );
        if (!updateEdgeFunction.results) {
          throw updateEdgeFunction;
        }
        //update storage
        if (isCode()) myEdgeFunctions[functionIndex].code = newContent;
        if (isArgs()) myEdgeFunctions[functionIndex].json_args = newContent;
        context.globalState.update("FUNCTIONS", myEdgeFunctions);
        await doc.save();
        window.showInformationMessage(messages.updated(name));
      } catch (err) {
        console.error(err);
        if (err.detail === "Invalid token") updateToken(context);
        window.showErrorMessage(`${messages.somethingWrong} ${messages.updatedError(name)}`);
      }
    }
  } else {
    window.showErrorMessage(`${messages.fileMissing}`);
  }
}

/**
 * @param {{ name: String; code: String; language: String; id: Number; json_args: String; }} foo
 */
async function createLocalFunction(foo) {
  const { name, code, language, json_args } = foo;
  const nameWithSlashUnicode = slashUnicode(name);
  const localFunctionPath = `${AZION_EDGE_FUNCTIONS_PATH}/${nameWithSlashUnicode}`;
  const functionExtension = getFileExtension(language);
  const jsonArgsString = JSON.stringify(json_args);
  createFolder(localFunctionPath);
  createFile("code", code, localFunctionPath, functionExtension);
  createFile("args", jsonArgsString, localFunctionPath, "json");
}

// Flareact
async function createFlareactFunction(context) {
  const TOKEN = await context.secrets.get("TOKEN");

  const flaReactFunctionName = await window.showInputBox({
    placeHolder: messages.insertFunctionName,
  });

  const flaReactFunctionPath = `${USER_DOCUMENTS_PATH}/${flaReactFunctionName}`;

  const execCommand = async () => {
    await createProgress(
      messages.creatingFlareactFunction,
      exec(
        `npx flareact4azion init ${flaReactFunctionPath} git@github.com:aziontech/flareact4azion-template.git`
      )
    );
    await createProgress(
      messages.flareactInstallDependencies,
      exec(`cd ${flaReactFunctionPath} && npm install`)
    );
  };

  if (flaReactFunctionName) {
    try {
      await execCommand();
      const uri = Uri.file(flaReactFunctionPath);

      // automatically updating configs
      let azionConfig = getFileContent(`${flaReactFunctionPath}/azion.json`);
      azionConfig = JSON.parse(azionConfig);
      azionConfig["azion"].token = TOKEN;
      azionConfig["azion"].function_name = flaReactFunctionName;
      createFile("azion", JSON.stringify(azionConfig), flaReactFunctionPath, "json");

      await commands.executeCommand("vscode.openFolder", uri);
    } catch (err) {
      console.error(err);
    }
  }
}

/**
 * @param {ExtensionContext} context
 */
async function buildFlareactFunction(context) {
  const execCommand = async (/** @type {string} */ path) => {
    try {
      await createProgress(
        messages.buildFlereactFunction,
        exec(`cd ${path} && flareact4azion build`)
      );
    } catch (err) {
      console.log(err);
    }
  };

  const { path } = workspace.workspaceFolders[0].uri;
  try {
    await execCommand(path);
  } catch (err) {
    console.error(err);
  }
}

/**
 * @param {ExtensionContext} context
 */
async function publishFlareactFunction(context) {
  const { path } = workspace.workspaceFolders[0].uri;
  const functionName = getFunctionNameByPath(path);

  try {
    await createProgress(
      messages.flareactPublishingFunction,
      exec(`cd ${path} && npx flareact4azion publish`)
    );
    window.showInformationMessage(messages.flareactPublishFunction(functionName));
  } catch (err) {
    window.showErrorMessage(messages.somethingWrong);
  }
}

module.exports = {
  activate,
  deactivate,
};
