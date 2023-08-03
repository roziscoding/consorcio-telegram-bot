import "https://deno.land/std@0.197.0/dotenv/load.ts";
import { Bot, Context, InlineKeyboard, session, SessionFlavor } from "https://deno.land/x/grammy@v1.17.2/mod.ts";
import { conversations, createConversation } from "https://deno.land/x/grammy_conversations@v1.1.2/conversation.ts";
import { ConversationFlavor } from "https://deno.land/x/grammy_conversations@v1.1.2/mod.ts";
import { hydrate, HydrateFlavor } from "https://deno.land/x/grammy_hydrate@v1.3.1/mod.ts";
import {} from "https://deno.land/x/grammy_storages@v2.3.0/file/src/mod.ts";
import { ISession, MongoDBAdapter } from "https://deno.land/x/grammy_storages@v2.3.0/mongodb/src/mod.ts";
import { MongoClient } from "https://deno.land/x/mongo@v0.31.2/mod.ts";
import { Commands } from "https://raw.githubusercontent.com/grammyjs/commands/scope-filters/src/mod.ts";

type Consortium = {
  amount: number;
  participants: number;
  monthlyFee: number;
  currentMonth: number;
  winner: number;
  participantsList: Array<{ name: string; id: number }>;
  payments: Array<{
    timestamp: Date;
    participant: number;
    confirmed: boolean;
  }>;
};

type SessionData = { consortiums: Record<string, Consortium> };
type SessionContext = SessionFlavor<SessionData> & Context;
type BotContext =
  & ConversationFlavor<SessionContext>
  & HydrateFlavor<SessionContext>;

const client = new MongoClient();
await client.connect(Deno.env.get("MONGODB_URI") || "");
const db = client.database("test");
const sessions = db.collection<ISession>("sessions");

export const bot = new Bot<BotContext>(Deno.env.get("BOT_TOKEN") || "");

bot.use(session({
  storage: new MongoDBAdapter({ collection: sessions }),
  initial: () => ({
    consortiums: {},
  }),
}));
bot.use(conversations());
bot.use(hydrate());

const commands = new Commands<BotContext>();

bot.use(createConversation(async (conversation, ctx) => {
  await conversation.run(hydrate());
  await ctx.reply("Qual o valor total do consórcio?");
  const amount = await conversation.form.number();

  await ctx.reply("Quantos participantes?");
  const participants = await conversation.form.number();

  const monthlyFee = amount / participants;
  const formattedMonthlyFee = monthlyFee.toLocaleString(
    "pt-BR",
    { style: "currency", currency: "BRL" },
  );
  const formattedAmount = amount.toLocaleString(
    "pt-BR",
    { style: "currency", currency: "BRL" },
  );

  await ctx.reply(
    [
      `Valor total: ${formattedAmount}`,
      `Participantes: ${participants} participantes`,
      `Parcela: ${formattedMonthlyFee}`,
      `Duração: ${participants} meses`,
      "",
      "Confirmar início do consórcio?",
    ].join("\n"),
    {
      reply_markup: InlineKeyboard.from([[
        InlineKeyboard.text("Sim", "yes"),
        InlineKeyboard.text("Não", "no"),
      ]]),
    },
  );

  const confirmCtx = await conversation.waitForCallbackQuery(["yes", "no"]);

  if (confirmCtx.callbackQuery.data === "no") {
    await confirmCtx.answerCallbackQuery("Consórcio cancelado");
    return await confirmCtx.deleteMessage().catch(() =>
      confirmCtx.editMessageText("Consórcio cancelado", {
        reply_markup: {
          inline_keyboard: [],
        },
      })
    );
  }

  const consortiumId = crypto.randomUUID();

  conversation.session.consortiums = conversation.session.consortiums || {};

  conversation.session.consortiums[consortiumId] = {
    amount,
    participants,
    monthlyFee,
    currentMonth: 0,
    winner: 0,
    participantsList: [
      {
        name: confirmCtx.from.first_name,
        id: confirmCtx.from.id,
      },
    ],
    payments: [],
  };

  await confirmCtx.answerCallbackQuery("Consórcio iniciado");

  const consortiumText = [
    `Consórcio iniciado em <b>${new Date().toLocaleDateString("pt-BR")}</b>`,
    `Valor total: <b>${formattedAmount}</b>`,
    `Participantes: <b>${participants}</b>`,
    `Parcela: <b>${formattedMonthlyFee}</b>`,
    `Duração: <b>${participants} meses</b>`,
    `Mês atual: <b>1</b>`,
    "",
    "Let's fucking gooooo 🤑",
    "",
    "Lista de participantes:",
    `- <b>${confirmCtx.from.first_name}</b>`,
    "",
    'Clique em "Participar" para entrar no consórcio.',
  ].join("\n");

  await confirmCtx.editMessageText(consortiumText, {
    reply_markup: InlineKeyboard.from([[
      InlineKeyboard.text("Participar", `join:${consortiumId}`),
    ]]),
    parse_mode: "HTML",
  });
}, { id: "createNew" }));

bot.callbackQuery(/join:(.*)/, async (ctx) => {
  const [, consortiumId] = ctx.match;

  const consortium = ctx.session.consortiums[consortiumId];

  if (
    consortium.participantsList.some((participant) => participant.id === ctx.from.id)
  ) {
    return ctx.answerCallbackQuery(
      "Você já está participando deste consórcio!",
    );
  }

  const oldText = ctx.callbackQuery.message?.text!.split("\n");

  if (!oldText) {
    return ctx.answerCallbackQuery("Erro ao inscrever-se no consórcio");
  }

  consortium.participantsList.push({
    name: ctx.from.first_name,
    id: ctx.from.id,
  });

  const isComplete = consortium.participantsList.length >= consortium.participants;

  const newText = oldText?.toSpliced(
    oldText.length - 2,
    0,
    `- ${ctx.from.first_name}`,
  );

  if (isComplete) {
    const today = new Date();
    const firstDraw = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      .toLocaleDateString("pt-BR");
    newText?.splice(
      newText.length - 1,
      1,
      "<i>Lista de participantes preenchida!</i>",
      "",
      `Data do primeiro sorteio: <b>${firstDraw}</b>`,
      "",
      "Boa sorte!",
    );
  }

  const replyMarkup = isComplete ? { inline_keyboard: [] } : ctx.callbackQuery.message?.reply_markup;

  await ctx.callbackQuery.message?.editText(newText.join("\n"), {
    reply_markup: replyMarkup,
    parse_mode: "HTML",
  });

  return ctx.answerCallbackQuery();
});

commands.command("start", "Inicializa o bot")
  .addToScope(
    { type: "all_private_chats" },
    (ctx) => ctx.reply("Me adicione a um grupo!"),
  )
  .addToScope(
    { type: "all_group_chats" },
    (ctx) => ctx.reply("Pra começar um novo consórcio, digite /novo"),
  );

commands.command("novo", "Cria um novo consórcio").addToScope({
  type: "all_group_chats",
}, (ctx) => ctx.conversation.enter("createNew"));

bot.use(commands);
