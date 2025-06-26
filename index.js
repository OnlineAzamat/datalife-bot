require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs');

const checkSubscription = require('./utils/checkSubscription');
const bot = new Telegraf(process.env.BOT_TOKEN);
const courses = JSON.parse(fs.readFileSync('./data/courses.json', 'utf-8'));
const LocalSession = require('telegraf-session-local');
const session = new LocalSession();
bot.use(session.middleware());
const registrationPath = './data/registrations.json';

bot.start((ctx) => {
  ctx.reply(`Assalomu alaykum, ${ctx.from.first_name}!\nO‘quv markazimiz botiga xush kelibsiz.`, {
    reply_markup: {
      keyboard: [
        ['📚 Kurslar', '📝 Kursga yozilish'],
        ['👨‍🏫 Admin bilan bog‘lanish', '📢 Bizning kanal']
      ],
      resize_keyboard: true
    }
  });
});

bot.use(async (ctx, next) => {
  const allowedRoutes = ['/start', '📢 Bizning kanal'];
  const text = ctx.message?.text;

  if (ctx.chat.type === 'private' && !allowedRoutes.includes(text)) {
    const isSubscribed = await checkSubscription(ctx.from.id, process.env.CHANNEL_USERNAME, process.env.BOT_TOKEN);
    
    if (!isSubscribed) {
      return ctx.reply(
        `❗️Botdan foydalanish uchun bizning kanalga a’zo bo‘ling:\n${process.env.CHANNEL_USERNAME}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📢 Kanalga o‘tish', url: `https://t.me/${process.env.CHANNEL_USERNAME.replace('@', '')}` }],
              [{ text: '✅ A’zo bo‘ldim', callback_data: 'check_sub_again' }]
            ]
          }
        }
      );
    }
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

bot.hears('📚 Kurslar', async (ctx) => {
  const courseButtons = courses.map((course) => [course.title]);

  await ctx.reply('Quyidagi kurslardan birini tanlang:', {
    reply_markup: {
      keyboard: [...courseButtons, ['🔙 Bosh menyu']],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
});

bot.hears('📝 Kursga yozilish', (ctx) => {
  ctx.session.registration = {};
  ctx.session.step = 'get_name';

  ctx.reply('Iltimos, ismingizni yozing:');
});

bot.command('foydalanuvchilar', (ctx) => {
  const admins = process.env.ADMIN_IDS.split(',');
  if (!admins.includes(ctx.from.id.toString())) {
    return ctx.reply('❌ Sizda ruxsat yo‘q.');
  }

  let list = [];

  try {
    list = JSON.parse(fs.readFileSync('./data/registrations.json', 'utf-8'));
  } catch (e) {
    return ctx.reply('📂 Hozircha ro‘yxatdan o‘tganlar yo‘q.');
  }

  if (list.length === 0) return ctx.reply('📂 Hozircha ro‘yxatdan o‘tganlar yo‘q.');

  const chunks = chunkArray(list, 10); // uzun ro'yxatlarni bo'lish
  chunks.forEach((group, index) => {
    let text = `📋 Foydalanuvchilar ro‘yxati (${index + 1}-qism):\n\n`;
    group.forEach((item, i) => {
      text += `${i + 1}. 👤 ${item.name}, 📱 ${item.phone}, 📚 ${item.course}\n`;
    });
    ctx.reply(text);
  });
});

bot.command('admin', (ctx) => {
  const admins = process.env.ADMIN_IDS.split(',');
  if (!admins.includes(ctx.from.id.toString())) {
    return ctx.reply('❌ Sizda admin panelga ruxsat yo‘q.');
  }

  return ctx.reply('⚙️ Admin panel:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Kurs qo‘shish', callback_data: 'add_course' }],
        [{ text: '➖ Kurs o‘chirish', callback_data: 'delete_course' }],
        [{ text: '🗑 Ro‘yxatni tozalash', callback_data: 'clear_registrations' }],
        [{ text: '📋 Ro‘yxatni ko‘rish', callback_data: 'list_users' }]
      ]
    }
  });
});

// Ro'yxatni bo'lish funksiyasi
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const step = ctx.session?.step;

  // 1. Bosh menyuga qaytish
  if (text === '🔙 Bosh menyu' || text === '🔙 Bekor qilish') {
    ctx.session.step = null;
    ctx.session.registration = null;

    return ctx.reply('Asosiy menyu:', {
      reply_markup: {
        keyboard: [
          ['📚 Kurslar', '📝 Kursga yozilish'],
          ['👨‍🏫 Admin bilan bog‘lanish', '📢 Bizning kanal']
        ],
        resize_keyboard: true
      }
    });
  }

  // 2. Kursga yozilish bosqichlari
  if (step === 'get_name') {
    ctx.session.registration.name = text;
    ctx.session.step = 'get_phone';
  
    return ctx.reply('📱 Telefon raqamingizni yuboring:', {
      reply_markup: {
        keyboard: [
          [{ text: '📤 Raqamni yuborish', request_contact: true }],
          ['🔙 Bekor qilish']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
  }

  if (step === 'select_course') {
    const course = courses.find(c => c.title === text);
    if (!course) return ctx.reply('Noto‘g‘ri kurs tanlovi. Iltimos, qayta tanlang.');

    ctx.session.registration.course = course.title;

    const reg = ctx.session.registration;
    const msg = `📝 *Yangi ro'yxatdan o'tish:*\n\n👤 Ism: ${reg.name}\n📱 Telefon: ${reg.phone}\n📚 Kurs: ${reg.course}`;

    const admins = process.env.ADMIN_IDS.split(',');
    for (const adminId of admins) {
      await ctx.telegram.sendMessage(adminId, msg, { parse_mode: 'Markdown' });
    }

    await ctx.reply('✅ Yozuv muvaffaqiyatli yuborildi! Tez orada siz bilan bog‘lanamiz.');
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

    return ctx.reply('Asosiy menyu:', {
      reply_markup: {
        keyboard: [
          ['📚 Kurslar', '📝 Kursga yozilish'],
          ['👨‍🏫 Admin bilan bog‘lanish', '📢 Bizning kanal']
        ],
        resize_keyboard: true
      }
    });
  }

  // 3. Kurs ma'lumotini ko‘rsatish (agar yozilish holatida emas)
  const selectedCourse = courses.find(course => course.title === text);
  if (selectedCourse) {
    const info = `📘 *${selectedCourse.title}*\n\n📝 ${selectedCourse.description}\n⏱ Davomiyligi: ${selectedCourse.duration}\n💰 Narxi: ${selectedCourse.price}`;

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
});

// Telefon raqamni olish uchun 'contact' hodisasi
bot.on('contact', (ctx) => {
  if (ctx.session?.step !== 'get_phone') return;

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

  const courseButtons = courses.map((c) => [c.title]);
  return ctx.reply('Qaysi kursga yozilmoqchisiz?', {
    reply_markup: {
      keyboard: [...courseButtons, ['🔙 Bekor qilish']],
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