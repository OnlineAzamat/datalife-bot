require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const { OpenAI } = require("openai");
const LocalSession = require('telegraf-session-local');
const session = new LocalSession();
const { search } = require("./search");

const checkSubscription = require('./utils/checkSubscription');
const { Pool } = require('pg');
const courses = JSON.parse(fs.readFileSync('./data/courses.json', 'utf-8'));
const registrationPath = './data/registrations.json';
const locales = JSON.parse(fs.readFileSync('./data/locales.json', 'utf-8'));
const bot = new Telegraf(process.env.BOT_TOKEN);

// 🧠 OpenAI sozlamalari
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const db = new Pool({
  host: process.env.PG_HOST || 'localhost',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'Byudjet2020#',
  database: process.env.PG_DB || 'rag_chatbot',
  port: process.env.PG_PORT || 5432,
});

bot.use(session.middleware());

// 📂 Har bir foydalanuvchining suhbati DBda saqlanadi
async function saveMessage(user_id, role, message) {
  await db.query(
    `INSERT INTO conversations (user_id, role, message) VALUES ($1, $2, $3)`,
    [user_id, role, message]
  );
}

// ⏪ Oxirgi 6 xabarni olish (3 savol + 3 javob)
async function getChatHistory(user_id) {
  const res = await db.query(
    `SELECT role, message FROM conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 6`,
    [user_id]
  );

  // 'message' maydonini 'content' qilib qaytaramiz
  return res.rows.reverse().map(row => ({
    role: row.role,
    content: row.message, // ❗ bu yer muhim
  }));
}

bot.start((ctx) => {
  ctx.session.lang = 'uz'; // Default til
  return ctx.reply(t(ctx, 'select_language'), {
    reply_markup: languageKeyboard()
  });
});

bot.action(/^lang_(.+)/, (ctx) => {
  const selectedLang = ctx.match[1];
  ctx.session.lang = selectedLang;

  const name = ctx.from.first_name || '';
  const welcomeText = t(ctx, 'start').replace('{name}', name);

  return ctx.reply(welcomeText, {
    reply_markup: {
      keyboard: [
        [t(ctx, 'button_courses'), t(ctx, 'button_register')],
        [t(ctx, 'button_contact'), t(ctx, 'button_channel')],
        [t(ctx, 'ask_question')], [t(ctx, 'button_lang')]
      ],
      resize_keyboard: true
    }
  });
});

// Language
function t(ctx, key) {  
  const lang = ctx.session && ctx.session.lang ? ctx.session.lang : 'uz';
  const set = locales[lang];
  return set && set[key] ? set[key] : key;
}

function languageKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🇺🇿 O‘zbek', callback_data: 'lang_uz' },
        { text: '🇬🇧 English', callback_data: 'lang_en' }
      ],
      [
        { text: '🇷🇺 Русский', callback_data: 'lang_ru' },
        { text: 'Qaraqalpaqsha', callback_data: 'lang_kaa' }
      ]
    ]
  };
}

const rateLimit = {};

bot.use(async (ctx, next) => {
  const text = ctx.message?.text;
  const userId = ctx.from?.id;
  const now = Date.now();

  const bypassTexts = [
    '/start',
    t(ctx, 'button_lang'),
    t(ctx, 'button_courses'),
    t(ctx, 'button_register'),
    t(ctx, 'button_contact'),
    t(ctx, 'button_channel'),
    t(ctx, 'main_menu'),
    t(ctx, 'menu'),
    t(ctx, 'cancel')
  ];

  if (ctx.chat.type === 'private' && ctx.updateType === 'message' && !bypassTexts.includes(text)) {
    const isSubscribed = await checkSubscription(ctx.from.id, process.env.CHANNEL_USERNAME, process.env.BOT_TOKEN);

    if (!isSubscribed) {
      await ctx.reply(`${t(ctx, 'important_channel_link')}\n${process.env.CHANNEL_USERNAME}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: t(ctx, 'to_channel'), url: `https://t.me/${process.env.CHANNEL_USERNAME.replace('@', '')}` }],
              [{ text: t(ctx, 'became_member'), callback_data: 'check_sub_again' }]
            ]
          }
        }); // Kanalga a'zo bo'lishni so'rash
      return;
    }
  }

  if (!rateLimit[userId]) rateLimit[userId] = [];
  rateLimit[userId] = rateLimit[userId].filter(ts => now - ts < 60_000); // oxirgi 1 daqiqa

  if (rateLimit[userId].length >= 3) {
    return ctx.reply( t(ctx, "rate_wait_message") );
  }

  return next();
});

// "✅ A’zo bo‘ldim" tugmasi bosilganda yana tekshiramiz
bot.action('check_sub_again', async (ctx) => {
  const isSubscribed = await checkSubscription(ctx.from.id, process.env.CHANNEL_USERNAME, process.env.BOT_TOKEN);

  if (isSubscribed) {
    ctx.reply('✅ Rahmat! Endi botdan to‘liq foydalanishingiz mumkin.');
  } else {
    ctx.reply('❗️Hali ham kanalga a’zo emassiz. Iltimos, a’zo bo‘ling va yana urinib ko‘ring.');
  }
});

bot.command('foydalanuvchilar', (ctx) => {
  const admins = process.env.ADMIN_IDS.split(',');
  if (!admins.includes(ctx.from.id.toString())) {
    return ctx.reply( t(ctx, 'dont_have_permission') );
  }

  let list = [];

  try {
    list = JSON.parse(fs.readFileSync('./data/registrations.json', 'utf-8'));
  } catch (e) {
    return ctx.reply( t(ctx, 'no_registered_users') );
  }

  if (list.length === 0) return ctx.reply( t(ctx, 'no_registered_users') );

  const chunks = chunkArray(list, 10); // uzun ro'yxatlarni bo'lish
  chunks.forEach((group, index) => {
    let text = `${t(ctx, 'list_of_users')} (${index + 1}-qism):\n\n`;
    group.forEach((item, i) => {
      text += `${i + 1}. 👤 ${item.name}, 📱 ${item.phone}, 📚 ${item.course}\n`;
    });
    ctx.reply(text);
  });
});

bot.command('admin', (ctx) => {
  const admins = process.env.ADMIN_IDS.split(',');
  if (!admins.includes(ctx.from.id.toString())) {
    return ctx.reply( t(ctx, 'dont_have_access') );
  }

  return ctx.reply('⚙️ Admin panel:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: t(ctx, 'add_course'), callback_data: 'add_course' }],
        [{ text: t(ctx, 'delete_course'), callback_data: 'delete_course' }],
        [{ text: t(ctx, 'clear_registrations'), callback_data: 'clear_registrations' }],
        [{ text: t(ctx, 'show_list_users'), callback_data: 'list_users' }],
        [{ text: '📢 Xabar jo\'natish', callback_data: 'send_message' }],
      ]
    }
  });
});

// Xabar jo'natish uchun callback
bot.action('send_message', (ctx) => {
  ctx.session.step = 'admin_send_message';
  return ctx.reply('📝 Jo\'natmoqchi bo\'lgan xabaringizni yozing:');
});

// Ro'yxatni bo'lish funksiyasi
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

bot.on('text', async (ctx, next) => {
  if (!ctx.session.lang) return ctx.reply(t(ctx, 'before_select_lang'));
  const lang = ctx.session.lang;

  const userId = String(ctx.from.id);
  const text = ctx.message.text;
  const step = ctx.session?.step;

  if (text === t(ctx, "button_close")) {
    ctx.session.step = null;
    ctx.session.expectingQuestion = false;
    ctx.session.waitingForResponse = false;
    ctx.session.messageCount = 0;

    return ctx.reply( t(ctx, 'close_message'), {
      reply_markup: {
        keyboard: [
          [t(ctx, 'button_courses'), t(ctx, 'button_register')],
          [t(ctx, 'button_contact'), t(ctx, 'button_channel')],
          [t(ctx, 'ask_question')], [t(ctx, 'button_lang')]
        ],
        resize_keyboard: true
      }
    });
  }

  if (ctx.session?.step === 'admin_send_message') {
    const admins = process.env.ADMIN_IDS.split(',');
    if (!admins.includes(ctx.from.id.toString())) {
      return ctx.reply('❌ Sizda adminlik huquqi yo\'q');
    }

    try {
      // Barcha foydalanuvchilar ro'yxatini olish
      const users = JSON.parse(fs.readFileSync('./data/registrations.json', 'utf8'));
      let successCount = 0;
      let errorCount = 0;

      // Har bir foydalanuvchiga xabar jo'natish
      for (const user of users) {
        try {
          await ctx.telegram.sendMessage(user.userId, ctx.message.text);
          successCount++;
        } catch (error) {
          console.error(`Error sending message to user ${user.userId}:`, error);
          errorCount++;
        }
        // Har bir xabar orasida 50ms kutish
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      ctx.session.step = null;
      return ctx.reply(`✅ Xabar jo'natildi:\n✅ Muvaffaqiyatli: ${successCount}\n❌ Xatolik: ${errorCount}`);

    } catch (error) {
      console.error('Error sending broadcast message:', error);
      return ctx.reply('❌ Xabar jo\'natishda xatolik yuz berdi');
    }
  }

  if (ctx.message.text === t(ctx, 'ask_question')) {
    ctx.session.step = 'ask_question';
    return ctx.reply( t(ctx, 'write_question'), {
      reply_markup: {
        keyboard: [[ t(ctx, 'button_close') ]],
        resize_keyboard: true
      }
    });
  }

  if (step === 'ask_question') {
    // Foydalanuvchi xabarlarini hisoblash uchun sessiya qiymatini tekshiramiz
    if (!ctx.session.messageCount) {
      ctx.session.messageCount = 0; // Agar mavjud bo'lmasa, 0 ga o'rnatamiz
    }
    console.log(ctx.session.messageCount);
    
    // Xabarlar sonini oshiramiz
    ctx.session.messageCount++;

    // Maksimal 10 ta xabarni tekshiramiz
    if (ctx.session.messageCount > 10) {
      ctx.session.step = null; // Bosqichni tozalaymiz
      ctx.session.messageCount = 0; // Hisoblagichni qayta tiklaymiz

      return ctx.reply("❗️ Sizning chat sessiyangiz yakunlandi. Yangi savol berish uchun qayta boshlang.", {
        reply_markup: {
          keyboard: [
            [t(ctx, 'button_courses'), t(ctx, 'button_register')],
            [t(ctx, 'button_contact'), t(ctx, 'button_channel')],
            [t(ctx, 'ask_question')], [t(ctx, 'button_lang')]
          ],
          resize_keyboard: true
        }
      });
    }

    const now = Date.now();
    // 10 minut ishinde xabar jazılmasa chattı juwmaqlaw
    if (ctx.session.lastInteraction && now - ctx.session.lastInteraction > 10 * 60 * 1000) {
      ctx.session.step = null;
      ctx.session.expectingQuestion = false;
      ctx.session.waitingForResponse = false;
      ctx.session.messageCount = 0;
    }
    ctx.session.lastInteraction = now;


    // 🔐 Parallel so'rovlar bo'lmasligi uchun tekshiruv
    if (ctx.session.waitingForResponse) return;
    ctx.session.waitingForResponse = true;
  
    // ⏳ Loading xabari
    const loadingMsg = await ctx.reply(t(ctx, 'res_waiting_ai'));
  
    try {
      const results = await search(text, 1);

      if (!results.length || !results[0].text) {
        await ctx.reply("Kechirasiz, savolingiz bo‘yicha mos ma’lumot topilmadi.");
        return;
      }

      const contextText = results[0].text;
      const history = await getChatHistory(userId);
      
      const messages = [
        { role: "system", content: `Sen foydalanuvchiga '${ctx.session.lang}' tilida yordam beradigan sun'iy intellektsan.` },
        ...history,
        { role: "user", content: text },
        { role: "system", content: contextText },
      ];
  
      // 🧠 OpenAI'dan javob
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
      });
  
      const answer = completion.choices[0].message.content;
  
      // 📥 Bazaga yozish
      await saveMessage(userId, "user", text);
      await saveMessage(userId, "assistant", answer);
      
      // ✅ Javob yuborish
      await ctx.reply(answer);
      
      // 🤝 Endi yangi savol kutish holatiga o'tkazamiz
      ctx.session.expectingQuestion = true;
      await ctx.reply(t(ctx, "write_or_finish_message"), Markup.keyboard([[ t(ctx, "button_close") ]]).resize());
    } catch (err) {
      console.error("OpenAI xatosi:", err.message);
      await ctx.reply("Kechirasiz, javob olishda xatolik yuz berdi.");
    } finally {
      // ⛔ Loaderni o'chirish va flagni tiklash
      ctx.session.waitingForResponse = false;
      ctx.deleteMessage(loadingMsg.message_id).catch(() => {});
      ctx.session.step = "ask_question"; // Davom etsin
    }
  }

  if (ctx.message.text === t(ctx, 'button_lang')) {
    return ctx.reply(t(ctx, 'select_language'), {
      reply_markup: languageKeyboard()
    });
  }

  if (text === t(ctx, 'button_courses')) {
    const courseButtons = courses.map((course) => [course.content[lang].title]);
  
    return ctx.reply(t(ctx, 'select_course'), {
      reply_markup: {
        keyboard: [...courseButtons, [t(ctx, 'main_menu')]],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  }

  if (text === t(ctx, 'button_register')) {
    ctx.session.registration = {};
    ctx.session.step = 'get_name';

    ctx.reply(( t(ctx, 'reply_name') ));
  }

  // 1. Bosh menyuga qaytish
  if (text === t(ctx, 'main_menu') || text === t(ctx, 'cancel')) {
    ctx.session.step = null;
    ctx.session.registration = null;
  
    return ctx.reply(t(ctx, 'menu'), {
      reply_markup: {
        keyboard: [
          [t(ctx, 'button_courses'), t(ctx, 'button_register')],
          [t(ctx, 'button_contact'), t(ctx, 'button_channel')],
          [t(ctx, 'ask_question')], [t(ctx, 'button_lang')]
        ],
        resize_keyboard: true
      }
    });
  }

  // 2. Kursga yozilish bosqichlari
  if (step === 'get_name') {
    ctx.session.registration.name = text;
    ctx.session.step = 'get_phone';
  
    return ctx.reply(t(ctx, 'send_ur_phone'), {
      reply_markup: {
        keyboard: [
          [{ text: t(ctx, 'button_send_phone_number'), request_contact: true }],
          [ t(ctx, 'cancel') ]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  }

  if (step === 'select_course') {
    const course = courses.find(c => c.content[lang].title === text);
    if (!course) return ctx.reply( t(ctx, 'invalid_course') );

    ctx.session.registration.course = course.content[lang].title;

    const reg = ctx.session.registration;
    const msg = `📝 *Yangi ro'yxatdan o'tish:*\n\n📩 ID: ${ctx.from.id} \n👤 Ism: ${reg.name}\n📱 Telefon: +${reg.phone}\n📚 Kurs: ${reg.course}`;

    const admins = process.env.ADMIN_IDS.split(',');
    for (const adminId of admins) {
      await ctx.telegram.sendMessage(adminId, msg, { parse_mode: 'Markdown' });
    }

    await ctx.reply( t(ctx, 'sent_successfully') );
    let registrations = [];

    try {
      registrations = JSON.parse(fs.readFileSync(registrationPath, 'utf-8'));
    } catch (e) {
      registrations = [];
    }

    registrations.push({
      name: reg.name,
      phone: reg.phone,
      course: reg.course,
      userId: ctx.from.id,
      date: new Date().toISOString()
    });

    fs.writeFileSync(registrationPath, JSON.stringify(registrations, null, 2));

    ctx.session.step = null;
    ctx.session.registration = null;

    return ctx.reply( t(ctx, 'menu') , {
      reply_markup: {
        keyboard: [
          [ t(ctx, 'button_courses'), t(ctx, 'button_register') ],
          [ t(ctx, 'button_contact'), t(ctx, 'button_channel') ],
          [ t(ctx, 'button_lang') ]
        ],
        resize_keyboard: true
      }
    });
  }

  // 3. Kurs ma'lumotini ko‘rsatish (agar yozilish holatida emas)
  const selectedCourse = courses.find(course => course.content[lang].title === text);
  if (selectedCourse) {
    const info = `📘 *${selectedCourse.content[lang].title}*\n\n📝 ${selectedCourse.content[lang].description}\n⏱ Davomiyligi: ${selectedCourse.duration}\n💰 Narxi: ${selectedCourse.price}`;

    if (selectedCourse.image) {
      await ctx.replyWithPhoto({ url: selectedCourse.image }, { caption: info, parse_mode: 'Markdown' });
    } else {
      await ctx.reply(info, { parse_mode: 'Markdown' });
    }
  }
  
  // ADD COURSE - step-by-step
  if (ctx.session?.step === 'admin_add_title') {
    ctx.session.newCourse.title = text;
    ctx.session.step = 'admin_add_description';
    return ctx.reply('📝 Kurs tavsifini yozing:');
  }

  if (ctx.session?.step === 'admin_add_description') {
    ctx.session.newCourse.description = text;
    ctx.session.step = 'admin_add_duration';
    return ctx.reply('⏱ Kurs davomiyligini yozing (masalan: 3 oy):');
  }

  if (ctx.session?.step === 'admin_add_duration') {
    ctx.session.newCourse.duration = text;
    ctx.session.step = 'admin_add_price';
    return ctx.reply('💰 Narxni yozing:');
  }

  if (ctx.session?.step === 'admin_add_price') {
    ctx.session.newCourse.price = text;
    ctx.session.step = 'admin_add_image';
    return ctx.reply('🖼 Rasm URL manzilini yuboring (yoki "yo‘q" deb yozing):');
  }

  if (ctx.session?.step === 'admin_add_image') {
    ctx.session.newCourse.image = text === 'yo‘q' ? '' : text;
    const coursesPath = './data/courses.json';
    const existingCourses = JSON.parse(fs.readFileSync(coursesPath, 'utf-8'));

    const newCourse = {
      id: Date.now(),
      ...ctx.session.newCourse
    };

    existingCourses.push(newCourse);
    fs.writeFileSync(coursesPath, JSON.stringify(existingCourses, null, 2));

    ctx.session.step = null;
    ctx.session.newCourse = null;

    return ctx.reply('✅ Kurs muvaffaqiyatli qo‘shildi.');
  }

  // Admin bilan bog‘lanish
  if (text === t(ctx, 'button_contact')) {
    return ctx.reply(t(ctx, 'contact_info'));
  }

  // Kanal havolasi
  if (text === t(ctx, 'button_channel')) {
    return ctx.reply(`${t(ctx, 'channel_link')} ${process.env.CHANNEL_USERNAME}`);
  }
});

// Telefon raqamni olish uchun 'contact' hodisasi
bot.on('contact', (ctx) => {
  if (ctx.session?.step !== 'get_phone') return;
  let lang = ctx.session.lang || 'uz';

  // Asosiy tekshiruv: contact mavjudmi va telefon raqam borligiga ishonch hosil qilish
  if (!ctx.message.contact || !ctx.message.contact.phone_number) {
    return ctx.reply('❗️Raqamni olishda xatolik yuz berdi. Tugmadan foydalaning.');
  }

  // registration mavjud bo‘lmasa, yaratamiz
  if (!ctx.session.registration) {
    ctx.session.registration = {};
  }

  ctx.session.registration.phone = ctx.message.contact.phone_number;
  ctx.session.step = 'select_course';

  const courseButtons = courses.map((c) => [c.content[lang].title]);
  return ctx.reply( t(ctx, 'whichCourse') , {
    reply_markup: {
      keyboard: [...courseButtons, [ t(ctx, 'cancel') ]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
});

bot.action('add_course', (ctx) => {
  ctx.session.step = 'admin_add_title';
  ctx.session.newCourse = {};
  return ctx.reply('➕ Kurs nomini yozing:');
});

bot.action('delete_course', (ctx) => {
  const courseButtons = courses.map((c) => [{
    text: c.title,
    callback_data: `del_${c.id}`
  }]);

  return ctx.reply('Qaysi kursni o‘chirmoqchisiz?', {
    reply_markup: { inline_keyboard: courseButtons }
  });
});

bot.action(/del_(\d+)/, (ctx) => {
  const id = parseInt(ctx.match[1]);
  const coursePath = './data/courses.json';
  let courseList = JSON.parse(fs.readFileSync(coursePath, 'utf-8'));

  courseList = courseList.filter(c => c.id !== id);
  fs.writeFileSync(coursePath, JSON.stringify(courseList, null, 2));

  return ctx.reply('❌ Kurs o‘chirildi.');
});

bot.action('clear_registrations', (ctx) => {
  fs.writeFileSync('./data/registrations.json', '[]');
  return ctx.reply('🗑 Ro‘yxat tozalandi.');
});

bot.action('list_users', (ctx) => {
  ctx.telegram.sendMessage(ctx.chat.id, '/foydalanuvchilar');
});

bot.launch();