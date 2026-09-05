import pino from "pino";

const logger = pino({ name: "worker" });
logger.info({ mode: "offline" }, "worker skeleton ready; queue wiring is pending");
