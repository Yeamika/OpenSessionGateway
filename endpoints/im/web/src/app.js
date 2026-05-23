import { loadConfig } from "./config.js";
import { createStore } from "./state.js";
import { createTransport } from "./transport.js";
import { createImGatewayClient } from "./im-tools.js";
import { bindUi, refreshAll } from "./ui.js";

const store = createStore(loadConfig());
const transport = createTransport(() => store.get().config);
const client = createImGatewayClient(transport);

bindUi({ store, client });
refreshAll(store, client);
