const { initDb, addPlayer, removePlayer, listPlayers } = require('./db');
const { Telegraf } = require('telegraf');
const http = require('http');
const { getPlayer } = require('./db');

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(process.env.PORT || 3000);

if (!process.env.BOT_TOKEN) {
  console.error('BOT_TOKEN missing');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);

initDb()
  .then(() => {
    console.log('DB ready');
    return bot.launch();
  })
  .then(() => console.log('Bot launched'))
  .catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));


const ADMIN_ID = 492434371;
const players = new Map(); // userId -> user info
const moves = new Map(); // userId -> fileId (скрин хода)
const MAX_PLAYERS = 10;
let registrationOpen = false;
let expansionOpen = false;

function playerLabel(p) {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  const username = p.username ? `@${p.username}` : '';
  return `${name || 'Игрок'} ${username}`.trim();
}

async function handleMove(ctx, kind, fileId) {
    const wasSubmitted = moves.has(ctx.from.id);

    moves.set(ctx.from.id, { kind, fileId });

    await ctx.reply(
        wasSubmitted
        ? `Ход обновлён. (${moves.size}/${players.size})`
        : `Ход принят. (${moves.size}/${players.size})`
    );

    if (players.size > 0 && moves.size === players.size) {
        expansionOpen = false;

        const pack = [];
        for (const [userId, move] of moves.entries()) {
            const p = players.get(userId);
            pack.push({ ...move, caption: playerLabel(p) });
        }

        for (const chatId of players.keys()) {
            const legend = pack.map((item, i) => `${i + 1}. ${item.caption}`).join('\n');
            await bot.telegram.sendMessage(chatId, `📜 Все ходы получены:\n${legend}`);

            const media = pack.map((item) => ({
                type: item.kind,
                media: item.fileId,
            }));

            try {
                await bot.telegram.sendMediaGroup(chatId, media);
            } 
            catch (e) {
                console.error('Ошибка при отправке альбома:', e);

                await bot.telegram.sendMessage(chatId, 'Не удалось отправить альбом, отправляю по одному.');

                for (const item of pack) {
                    if (item.kind === 'photo') {
                        await bot.telegram.sendPhoto(chatId, item.fileId);
                    } else {
                        await bot.telegram.sendDocument(chatId, item.fileId);
                    }
                }
            }
        }
        moves.clear();
    }
}

async function countPlayers() {
  const res = await pool.query(`SELECT COUNT(*)::int AS cnt FROM players`);
  return res.rows[0].cnt;
}

async function hasPlayer(id) {
  const res = await pool.query(`SELECT 1 FROM players WHERE id=$1 LIMIT 1`, [id]);
  return res.rowCount > 0;
}

module.exports = { initDb, addPlayer, removePlayer, listPlayers, countPlayers, hasPlayer };

bot.start((ctx) => {
    ctx.reply('Mae govannen, mellon\nПриветствую тебя, друг');
});

bot.command('open', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply('Только админ может открыть регистрацию.');
  }

  registrationOpen = true;
  ctx.reply('Регистрация открыта.');
});

bot.command('lock', (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    return ctx.reply('Только админ может закрыть регистрацию.');
  }

  registrationOpen = false;
  ctx.reply('Регистрация закрыта.');
});

bot.command('join', async (ctx) => {
  if (!registrationOpen) return ctx.reply('Регистрация сейчас закрыта.');

  const userId = ctx.from.id;

  if (await hasPlayer(userId)) return ctx.reply('Ты уже зарегистрирован.');

  const total = await countPlayers();
  if (total >= MAX_PLAYERS) return ctx.reply('Достигнут максимум игроков.');

  await addPlayer({
    id: userId,
    username: ctx.from.username,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name,
  });

  ctx.reply('Ты успешно зарегистрирован.');
});

bot.command('add', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('Только админ.');

  const parts = ctx.message.text.trim().split(/\s+/);
  const idStr = parts[1];
  if (!idStr) return ctx.reply('Использование: /add <id>');

  const userId = Number(idStr);
  if (!Number.isInteger(userId)) return ctx.reply('ID должен быть числом.');

  if (await hasPlayer(userId)) return ctx.reply('Игрок уже зарегистрирован.');

  try {
    const chat = await bot.telegram.getChat(userId);

    await addPlayer({
      id: chat.id,
      first_name: chat.first_name || '',
      last_name: chat.last_name || '',
      username: chat.username || null,
    });

    return ctx.reply(
      `Добавлен: ${(chat.first_name || '')} ${(chat.last_name || '')} ` +
      `${chat.username ? `(@${chat.username})` : ''} [${chat.id}]`
    );
  } catch (e) {
    // fallback: добавляем без имени
    await addPlayer({ id: userId, first_name: 'Manual', last_name: '', username: null });
    return ctx.reply(`Добавлен вручную: [${userId}]. (Имя не получил — возможно, он не писал боту)`);
  }
});

bot.command('remove', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID)
    return ctx.reply('Только админ может удалять игроков.');

  const idStr = ctx.message.text.trim().split(/\s+/)[1];
  const userId = Number(idStr);
  if (!Number.isInteger(userId))
    return ctx.reply('Использование: /remove <id>');

  const player = await getPlayer(userId);
  if (!player)
    return ctx.reply('Игрок не найден.');

  await removePlayer(userId);

  const name = [player.first_name, player.last_name]
    .filter(Boolean)
    .join(' ');
  const username = player.username ? `(@${player.username})` : '';

  await ctx.reply(`Удалён: ${name} ${username} [${player.id}]`);
});

bot.command('players', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('Только админ может смотреть список игроков.');

  const rows = await listPlayers();
  if (rows.length === 0) return ctx.reply('Пока никто не зарегистрирован.');

  const text = rows.map((p, i) => {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
    const u = p.username ? `(@${p.username})` : '';
    return `${i + 1}. ${name} ${u} [${p.id}]`;
  }).join('\n');

  await ctx.reply(`Зарегистрированные игроки:\n\n${text}`);
});

bot.command('expand', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('Только админ.');
  if (registrationOpen) return ctx.reply('Открыта регистрация.');
  if (expansionOpen) return ctx.reply('Фаза уже открыта.');

  const rows = await listPlayers();
  if (rows.length === 0) return ctx.reply('Никто не зарегистрировался.');

  expansionOpen = true;

  const adminIsPlayer = rows.some(p => p.id === ADMIN_ID);

  // Если админ НЕ игрок — отдельно сообщаем ему
  if (!adminIsPlayer) {
    await ctx.reply('Вы открыли фазу экспансии');
  }

  for (const p of rows) {
    await bot.telegram.sendMessage(
      p.id,
      'Фаза экспансии открыта. Пришлите скрин.'
    );
  }
});

bot.command('endexpand', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) return ctx.reply('Только админ.');

  if (!expansionOpen) return ctx.reply('Фаза уже закрыта.');

  const rows = await listPlayers();

  expansionOpen = false;

  const adminIsPlayer = rows.some(p => p.id === ADMIN_ID);

  // Если админ не игрок — отдельно уведомляем
  if (!adminIsPlayer) {
    await ctx.reply('Вы закрыли фазу экспансии.');
  }

  for (const p of rows) {
    await bot.telegram.sendMessage(
      p.id,
      'Фаза экспансии закрыта.'
    );
  }
});

bot.command('expandinfo', async (ctx) => {
  if (!expansionOpen) {
    return ctx.reply('Фаза экспансии закрыта.');
  }

  const total = await countPlayers();
  const submitted = moves.size; // пока ходы в памяти

  await ctx.reply(`Ведется планирование.\nСдали: ${submitted}/${total}`);
});

bot.on('photo', async (ctx) => {
  if (!players.has(ctx.from.id)) return ctx.reply('Ты не зарегистрирован.');
  if (!expansionOpen) return ctx.reply('Сейчас фаза экспансии закрыта.');

  const photos = ctx.message.photo;
  const best = photos[photos.length - 1];

  await handleMove(ctx, 'photo', best.file_id);
});

bot.on('document', async (ctx) => {
  if (!players.has(ctx.from.id)) return ctx.reply('Ты не зарегистрирован.');
  if (!expansionOpen) return ctx.reply('Сейчас фаза экспансии закрыта.');

  const doc = ctx.message.document;

  if (!doc.mime_type || !doc.mime_type.startsWith('image/')) {
    return ctx.reply('Нужно отправить изображение.');
  }

  await handleMove(ctx, 'document', doc.file_id);
});
