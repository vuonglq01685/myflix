import pino from "pino";

export const logger = pino({
  browser: {
    asObject: true,
    write: (o: object) => {
      // eslint-disable-next-line no-console -- AC18 pino browser-mode sink; this IS the log output, not a debug statement
      console.log(JSON.stringify(o));
    },
  },
});
