import { bot } from "./bot.ts";

bot.start({
  onStart: (me) => {
    console.log(`Bot started as @${me.username}`);
  },
});
