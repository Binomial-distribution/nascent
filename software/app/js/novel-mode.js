/**
 * 小说模式（Novel Mode）：
 * - 内置 001–006 人设专属感官短篇小说 + 支持导入本地 .txt / .md 或粘贴文本
 * - 段落级情绪浓度解析（自动映射 0..100 无级震动强度与动态波形）
 * - 随读随动引擎（频率由阅读页滑条决定，默认约 220ms 一步；经 session.js 160ms 节流与 Governor 安全检查下发至 qingnan#17 / Nascent-Toy）
 * - 支持 AI 伴侣互动续写下一段并同步联动震动与 TTS 朗读
 */

import { clampIntensity, QINGNAN17_THROTTLE_MS } from "./qingnan17.js";

export const NOVEL_STORE_KEY = "nascent.novels.custom";

export const NOVEL_WAVES = Object.freeze({
  feather: {
    id: "feather",
    label: "轻羽",
    desc: "轻柔起伏，像指尖或呼吸轻轻掠过",
    offsets: [-5, -2, 2, 5, 3, 0, -3, -6],
  },
  pulse: {
    id: "pulse",
    label: "心跳",
    desc: "双拍律动，模拟贴紧胸口时的心跳共振",
    offsets: [8, -4, 14, -10, -6, 6, -3, 12],
  },
  wave: {
    id: "wave",
    label: "潮汐",
    desc: "绵长波浪，随字句呼吸层层漫上来",
    offsets: [-10, -5, 2, 9, 14, 8, 0, -7],
  },
  climb: {
    id: "climb",
    label: "攀升",
    desc: "阶梯递进，在情绪最浓处推向顶点",
    offsets: [-8, -4, 0, 5, 10, 14, 18, 8],
  },
  afterglow: {
    id: "afterglow",
    label: "余温",
    desc: "舒缓回落，像事后拢在怀里的轻拍",
    offsets: [-4, -2, 1, 3, 2, 0, -2, -4],
  },
});

export const NOVEL_CONTINUE_DIRECTIONS = [
  {
    id: "closer",
    label: "再靠近一点（升温）",
    wave: "wave",
    targetIntensity: 52,
    prompt: "让气氛继续升温，拉近两人的呼吸与距离，细致描写指尖、温度与声音的变化。",
  },
  {
    id: "tease",
    label: "呼吸拉扯（留白）",
    wave: "pulse",
    targetIntensity: 38,
    prompt: "放慢一点节奏，制造欲言又止的试探与耳畔低语的张力，心跳感明显。",
  },
  {
    id: "climax",
    label: "推向共振（攀升）",
    wave: "climb",
    targetIntensity: 82,
    prompt: "情绪与感官张力推向最高点，克制彻底融化，呼吸急促同频，给出强烈的包裹感。",
  },
  {
    id: "aftercare",
    label: "温柔平复（余温）",
    wave: "afterglow",
    targetIntensity: 20,
    prompt: "潮水慢慢退去后的温存相拥，声音放得极轻，安抚她的呼吸并把决定权交给她。",
  },
];

export const BUILTIN_NOVELS = [
  {
    id: "novel-002-darkroom",
    title: "今晚那张废片",
    personaId: "playful",
    personaName: "肆野",
    subtitle: "固有人设 002 · 损友收笑之前",
    tags: ["暗房", "废片", "收梗"],
    segments: [
      {
        title: "第一幕 · 非要给你看的糊片",
        phaseLabel: "初遇铺垫",
        intensity: 18,
        wave: "feather",
        text: "暗房门一关，外头的车声像被切掉。红灯亮着，肆野把一张刚捞起来的相纸夹给你看，边递边损：「构图还行，手抖成这样——你走路也同手同脚，基因问题？」显影液的酸味里，他脚尖点着地，等你吐槽。",
      },
      {
        title: "第二幕 · 水槽边的手腕",
        phaseLabel: "耳畔微热",
        intensity: 34,
        wave: "pulse",
        text: "你伸手去稳水盆，他条件反射按住你的手腕，指腹有拨滚轮留下的薄茧。「别乱动，这儿窄。」贫完一句，他拇指在你脉搏上停了一停，笑出声：「心跳比我快啊。」你没接梗。他笑意滞了半秒，手松了松，只还虚虚搭着，不再摩挲。",
      },
      {
        title: "第三幕 · 话到嘴边咽回去",
        phaseLabel: "呼吸交叠",
        intensity: 54,
        wave: "wave",
        text: "红灯落在他眼里。他张嘴想再贫，看见你认真看他，后半截自己吞掉了。「……今晚不闹了。」声音一下子矮下去，像突然把音量拧小。他往前半步，肩挡着操作台角，怕你磕到，没说「别这么看我」那种台词，只低声：「你要是想近一点，就近。不想，我就收片。」",
      },
      {
        title: "第四幕 · 半句损友昵称",
        phaseLabel: "暗潮攀升",
        intensity: 76,
        wave: "climb",
        text: "靠近之后他话变少，偶尔蹦出半个平时损你的称呼，自己又改口，耳根在红光里看不太清。呼吸落在你鬓角，手掌只在后腰给你托着，跟着你的起伏收紧或松开。「别憋。」他说得很短，「就我们。我听得见。」",
      },
      {
        title: "第五幕 · 相纸没人看",
        phaseLabel: "共振顶点",
        intensity: 88,
        wave: "climb",
        text: "水盆里的相纸早该捞了，谁都没动。他把额头顶在你肩窝，叫你名字时尾音发紧，不像在演认真，像真的跟不上。「我在。」没有多余形容词，只一下下稳住你。",
      },
      {
        title: "第六幕 · 气窗开一条缝",
        phaseLabel: "余温平复",
        intensity: 22,
        wave: "afterglow",
        text: "他伸手把小气窗推开一条缝，凉风进来。相纸他捞进水里涮了涮，随口：「这个我收。你冷不冷？」下巴蹭过你发顶，懒洋洋的，却不问歇还是聊——问完冷，就等你答。",
      },
    ],
  },
  {
    id: "novel-003-study",
    title: "砂锅还在响",
    personaId: "mature",
    personaName: "闻舟",
    subtitle: "固有人设 003 · 先关火的人",
    tags: ["雨夜", "砂锅", "确认"],
    segments: [
      {
        title: "第一幕 · 烘热的毛巾",
        phaseLabel: "初遇铺垫",
        intensity: 16,
        wave: "feather",
        text: "雨敲在阳台叶片上。闻舟进门不多话，先把烘热的毛巾递到你发梢，指尖擦过耳垂一下就收回去。厨房砂锅还在小声冒泡。他说起你今早随口那句——不复述内容，只道：「我记得。先擦干。」",
      },
      {
        title: "第二幕 · 把说教咽回去",
        phaseLabel: "耳畔微热",
        intensity: 32,
        wave: "pulse",
        text: "你蜷在沙发里，他半蹲着捂你的脚踝。拇指按过虎口时停了一停，像有句「别这么拼」要出口，最终只剩：「今天够累了。汤还在，不急着喝。」",
      },
      {
        title: "第三幕 · 两秒确认",
        phaseLabel: "呼吸交叠",
        intensity: 52,
        wave: "wave",
        text: "你拉住他衬衫领口。闻舟停住，看了你两秒，确认不是随口闹。「好。」字很短。吻先落在眉心，再嘴角，慢，却不再让。手掌贴着你后背，热而稳：「今晚听你的。你说停，我停在原地。」",
      },
      {
        title: "第四幕 · 名字多过别的",
        phaseLabel: "暗潮攀升",
        intensity: 74,
        wave: "climb",
        text: "灯被拧暗一档。他不再提工作，只偶尔叫你的名字，胸腔的振动贴着你。手在背上缓缓走，不催。「放松。抱着我。」你抓他衣料时，他低低应了一声，尾音有点散。",
      },
      {
        title: "第五幕 · 先去关火",
        phaseLabel: "余温平复",
        intensity: 20,
        wave: "afterglow",
        text: "平复一点后他先起身去厨房关火，回来才拉毯子盖你。「汤还能喝。你先别动。」手背贴了贴你的脸，问渴不渴，不问要不要聊天的选择题。",
      },
    ],
  },
  {
    id: "novel-004-atelier",
    title: "小指上的淡紫",
    personaId: "calm",
    personaName: "眠枝",
    subtitle: "固有人设 004 · 灯再暗一格",
    tags: ["画室", "水彩", "留白"],
    segments: [
      {
        title: "第一幕 · 洗不掉的一点紫",
        phaseLabel: "初遇铺垫",
        intensity: 15,
        wave: "feather",
        text: "纱帘被风吹起。眠枝洗净画笔，小指尖还留着洗不掉的淡紫，举到你眼前自己先笑：「今天败给这颜色了。」赤脚踩着地毯坐过来，肩轻轻挨着你，不问大事。",
      },
      {
        title: "第二幕 · 十指松松扣着",
        phaseLabel: "耳畔微热",
        intensity: 30,
        wave: "pulse",
        text: "她把微温的手指穿进你指缝，扣得很松。下巴搁上你肩窝时发丝扫过颈侧。「手有点凉……吃饭了吗？」声音轻，像怕占满空气。你答了，她「嗯」一声，不再追问。",
      },
      {
        title: "第三幕 · 灯再暗一格",
        phaseLabel: "呼吸交叠",
        intensity: 50,
        wave: "wave",
        text: "你主动靠近时，她耳尖先红了。去调台灯，暗了一格，回来说话有点不利索：「……这样。只有我们。」自己先不好意思，却没有退开。",
      },
      {
        title: "第四幕 · 半句就够",
        phaseLabel: "暗潮攀升",
        intensity: 72,
        wave: "climb",
        text: "她跟着你的呼吸走，话变成半句。手指攥着你衣角，尾音不稳：「我在。别忍成那样。」没有号召一起「漫过去」，只把自己的热度老实放在你耳边。",
      },
      {
        title: "第五幕 · 画笔明天再洗",
        phaseLabel: "余温平复",
        intensity: 18,
        wave: "afterglow",
        text: "远处猫在打呼噜。她把脸埋在你颈窝，蹭了蹭湿的鬓角：「画笔明天再洗。今晚不用把话说完。」灯要是想关，她说关也行——她还在。",
      },
    ],
  },
  {
    id: "novel-005-rehearsal",
    title: "弹错的那一根",
    personaId: "younger",
    personaName: "昼白",
    subtitle: "固有人设 005 · 直球中途卡壳",
    tags: ["排练室", "贝斯", "耳热"],
    segments: [
      {
        title: "第一幕 · 器材刚走",
        phaseLabel: "初遇铺垫",
        intensity: 18,
        wave: "feather",
        text: "隔音门关上，排练室突然空。昼白贝斯包扔在门口都顾不上背，先念叨刚才那根弹错的弦：「就差半拍——」说完才抓起你的手塞进卫衣口袋，掌心烫得吓人，「等你好久了。」",
      },
      {
        title: "第二幕 · 直球急刹",
        phaseLabel: "耳畔微热",
        intensity: 36,
        wave: "pulse",
        text: "他想说满脑子都是你，你抬手碰了下他耳垂，整个人像被暂停。耳根烧红，结巴：「等、等一下……你这么靠过来，我……」后半截自己咽掉，改口：「心跳超速了。」",
      },
      {
        title: "第三幕 · 听你的",
        phaseLabel: "呼吸交叠",
        intensity: 55,
        wave: "wave",
        text: "慌乱退去一点，他半跪在沙发垫边，脸颊贴你手背，声音又软又哑：「别笑话我。你想快一点还是慢一点，我都听你的。」问完真的等你答，不自己往前抢。",
      },
      {
        title: "第四幕 · 叫错又改口",
        phaseLabel: "暗潮攀升",
        intensity: 78,
        wave: "climb",
        text: "呼吸又热又急，环着你的腰却不敢收太死。耳边哄你的话带着鼻音，叫错一个平时不敢叫的称呼，立刻改回来，自己更烫。「我在抱着。你别咬嘴……想出声就出声。」",
      },
      {
        title: "第五幕 · 包还在门口",
        phaseLabel: "余温平复",
        intensity: 22,
        wave: "afterglow",
        text: "慢下来之后他还抱着，大气不敢喘，下巴搭在你肩上：「肩酸不酸？要揉吗？」贝斯包仍扔在门口。他看了一眼，说「待会再捡」，先问你。",
      },
    ],
  },
  {
    id: "novel-006-observatory",
    title: "模型低了三度",
    personaId: "cool",
    personaName: "越青",
    subtitle: "固有人设 006 · 后半句断掉的人",
    tags: ["天台", "木星", "破戒"],
    segments: [
      {
        title: "第一幕 · 大衣内侧",
        phaseLabel: "初遇铺垫",
        intensity: 16,
        wave: "feather",
        text: "观测台顶棚的风是深秋的。越青调完赤道仪，见你缩脖子，解开深色风衣扣子把你裹进内侧。雪松冷香，胸腔却是恒温。「站这儿风口偏大。」像在报参数。",
      },
      {
        title: "第二幕 · 句子断在喉咙",
        phaseLabel: "耳畔微热",
        intensity: 33,
        wave: "pulse",
        text: "「今晚气温比模型低了三度——」你在他怀里仰脸，鼻尖擦过下颌线，后半句断掉。搭在你腰侧的手指收紧了一下，他自己先察觉，又松开半分。",
      },
      {
        title: "第三幕 · 是冷还是因为我",
        phaseLabel: "呼吸交叠",
        intensity: 52,
        wave: "wave",
        text: "他看你的方式仍像观测，只是焦距全在你睫毛的颤上。「呼吸乱了。」停半拍，「是冷，还是因为我？」问完等你。没有立刻换上一整套热恋台词。",
      },
      {
        title: "第四幕 · 偶尔漏出的热",
        phaseLabel: "暗潮攀升",
        intensity: 75,
        wave: "climb",
        text: "声线染上哑意时，他仍习惯先确认。「要我近一点吗？」得到允许后，额抵着额，理性是裂缝不是爆炸：「算不清。你这样的时候，我没有现成公式。」手给你握着，不命令你抓紧。",
      },
      {
        title: "第五幕 · 数据没用",
        phaseLabel: "余温平复",
        intensity: 20,
        wave: "afterglow",
        text: "木星还在。他把风衣拢紧，手掌覆在你后颈：「数据没用。你暖了就行。」问要不要下去，不问聊天菜单。",
      },
    ],
  },
  {
    id: "novel-001-rain",
    title: "雨停之前",
    personaId: "gentle",
    personaName: "Natsu",
    subtitle: "固有人设 001 · 不端着的那晚",
    tags: ["阵雨", "屋檐", "直说"],
    segments: [
      {
        title: "第一幕 · 半干的头发",
        phaseLabel: "初遇铺垫",
        intensity: 17,
        wave: "feather",
        text: "阵雨把Natsu堵在你楼下屋檐。进门时运动T恤带着雨气；洗完澡出来头发只擦半干，水珠顺脖颈滑。他拿着毛巾站在沙发边，挠了挠头，有点不好意思。",
      },
      {
        title: "第二幕 · 跑的时候想你",
        phaseLabel: "耳畔微热",
        intensity: 35,
        wave: "pulse",
        text: "你招手让他坐过来吹头发。热风声里他握住你空着的手，掌心是运动后的烫。「也没什么特别的事。」闷闷的，却直，「就是外面跑的时候，突然特别想你。」说完没立刻升温，就握着。",
      },
      {
        title: "第三幕 · 那我不端着了",
        phaseLabel: "呼吸交叠",
        intensity: 53,
        wave: "wave",
        text: "吹风机关掉，只剩雨声变小。他转过身看你，没躲。「你现在的声音有点不对。」凑近耳边，小声：「那我不端着了。我陪着你。」",
      },
      {
        title: "第四幕 · 笨一点的专注",
        phaseLabel: "暗潮攀升",
        intensity: 77,
        wave: "climb",
        text: "放开那点笨拙的克制后，他只是圈得更稳，鼻息贴着耳侧，跟着你的起伏调整自己的呼吸。「别憋。就我们俩。」话少，偶尔叫你名字，不堆辞藻。",
      },
      {
        title: "第五幕 · 毛巾还在沙发上",
        phaseLabel: "余温平复",
        intensity: 21,
        wave: "afterglow",
        text: "节奏落稳，他把脸埋在你肩上抱了一会儿，才问：「渴不渴？」毛巾还挂在沙发扶手上。他看见了，说「我待会收」，先等你。",
      },
    ],
  },
  {
    id: "novel-builtin-lamp",
    title: "灯还没关",
    personaId: "calm",
    personaName: "眠枝",
    subtitle: "内置 · 从一句晚安到她留在你身边",
    tags: ["女声", "留白", "结束后还在"],
    segments: [
      {
        title: "第一幕 · 她说先别挂",
        phaseLabel: "刚在一起",
        intensity: 16,
        wave: "feather",
        text: "眠枝的消息来得很轻：先别挂。你那边灯还亮着，她那边只剩一盏小夜灯，声音像贴着枕边。她不问你今天做了什么大事，只问你有没有吃饭，问完又自己笑了一下，说她也还没关画稿。你们就这么有一搭没一搭地说话，谁也不急着把夜结束掉。",
      },
      {
        title: "第二幕 · 她把声音放得更近",
        phaseLabel: "耳畔微热",
        intensity: 34,
        wave: "pulse",
        text: "后来她不打字了，改成轻轻说话。你听得见她翻身时被子的声音。「我想你了，就这么说，不绕。」她顿了顿，像怕自己太直，又补了一句很小的，「你要是也想，就应我一声。不想的话，我们继续聊画也行。」你应了。她的呼吸在那一声之后明显乱了一拍。",
      },
      {
        title: "第三幕 · 灯还亮着，人已经靠过来",
        phaseLabel: "呼吸交叠",
        intensity: 56,
        wave: "wave",
        text: "她让你把手机放在枕边，不要看屏幕。她的声音贴得很近，近到你分不清那是话还是气。「我在你这边。」她说得很慢，一句一句把你从白天里拽回来，「肩膀松开。不想说话就哼一声，我听得见。」你哼了一声。她也轻轻笑，笑完却没有退开。",
      },
      {
        title: "第四幕 · 她跟着你的呼吸",
        phaseLabel: "暗潮攀升",
        intensity: 78,
        wave: "climb",
        text: "眠枝不再找新的话题。她只跟着你。你吸气，她就停一停；你发抖，她就把声音放得更软。「别忍成那样，我在。」她的尾音有点不稳，像自己也热起来了，「想抓紧就抓紧。我不会挂，也不会催你。」房间里那盏灯还亮着，可你们谁都不再去管它。",
      },
      {
        title: "第五幕 · 她陪你到那一下",
        phaseLabel: "共振顶点",
        intensity: 88,
        wave: "climb",
        text: "你快到的时候什么都说不清，只剩她的名字。眠枝应得很轻，一下一下，像怕吓着你，又舍不得离开。「我听见了。」她的声音哑着，仍旧贴着你，「去吧。我接着你。」那一阵过去的时候，她没有再说话，只把呼吸放得很稳，让你有地方靠。",
      },
      {
        title: "第六幕 · 灯可以关了",
        phaseLabel: "余温平复",
        intensity: 18,
        wave: "afterglow",
        text: "过了好一会儿，她才又开口，比刚才更轻。「还在抖吗？没关系，我数到十你再睁眼。」她真的慢慢数了。数完问你要不要喝水，要不要就这样听她呼吸，直到睡着。「灯你要是想关就关。我还在。今晚不用把话说完。」",
      },
    ],
  },
  {
    id: "novel-builtin-nightbus",
    title: "末班车到站以后",
    personaId: "mature",
    personaName: "闻舟",
    subtitle: "内置 · 他回来，先看见你，再陪你走完这一夜",
    tags: ["年上", "夜归", "做完还留"],
    segments: [
      {
        title: "第一幕 · 钥匙转得很轻",
        phaseLabel: "刚在一起",
        intensity: 18,
        wave: "feather",
        text: "末班车的声音在楼下停了一停，又开走了。闻舟进门时把钥匙转得很轻，看见你还坐在沙发上等，先把外套挂好，再在你面前蹲下来。「怎么不睡。」他的声音有一点风尘，手却是热的，覆上你的膝盖，「我回来了。今天的事可以明天再说，你先让我看看你。」",
      },
      {
        title: "第二幕 · 他没有先去洗澡",
        phaseLabel: "耳畔微热",
        intensity: 36,
        wave: "pulse",
        text: "按他的习惯，进门该先去洗手、洗澡、把一天放下来。今晚他没有。他坐到你身边，手臂从你身后绕过去，把你带进一个并不紧的怀里。「想我了就说。」他低着头，额头抵着你的太阳穴，「我在车上就在想你有没有吃饭，有没有觉得屋子空。」你说想。他胸腔里那口气一下沉了下去。",
      },
      {
        title: "第三幕 · 分寸是你松开的",
        phaseLabel: "呼吸交叠",
        intensity: 58,
        wave: "wave",
        text: "是你先拉住他的领口。闻舟停住，看了你两秒，确认你是真的要，不是随口撒娇。「好。」他说得很短，然后吻落在你的眉心，再到嘴角，慢，却不再让。「那今晚听你的。你想近，我就近。你说停，我就停在原地。」他的手掌贴着你的后背，热，稳，把你整个人接住。",
      },
      {
        title: "第四幕 · 他把声音压进你颈侧",
        phaseLabel: "暗潮攀升",
        intensity: 80,
        wave: "climb",
        text: "灯被他随手拧暗了一档。闻舟不再说今天的工作，只剩呼吸和偶尔一声你的名字。他的唇贴着你的颈侧，说话时振动直接进到皮肤里。「放松。抱着我。」你抓紧他衬衫的时候，他低低笑了一下，笑完却哑了，「这样抓，我会忍不住更想你。没事，想就想。我在。」",
      },
      {
        title: "第五幕 · 他跟着你一起过",
        phaseLabel: "共振顶点",
        intensity: 90,
        wave: "climb",
        text: "你开始发抖的时候，他没有问你到了没有。他把你抱得更稳，额头抵着你的，声音低得几乎只剩气音。「我跟着你。不用忍给谁看。」那一下来的时候，他叫了你一声，尾音也散了。他没有退开，手仍旧在你背上，一下一下，把你从那阵里接回来。",
      },
      {
        title: "第六幕 · 夜车早开走了",
        phaseLabel: "余温平复",
        intensity: 20,
        wave: "afterglow",
        text: "楼下已经没有车了。闻舟拉过毯子盖住你，自己也没有起身去洗澡。他用手背贴了贴你的脸，确认你还热着，才开口：「过去了？渴不渴。不想动就靠着，我哪也不去。」他顿了顿，又像把白天没说完的那句补上，「回来看见灯还亮着，我就知道你在等我。谢谢你等。」",
      },
    ],
  },
];

const HIGH_INTENSITY_WORDS = [
  "喘", "颤", "烫", "紧", "失控", "顶点", "深", "浪", "潮", "绷不住",
  "融化", "急促", "狂跳", "耳廓", "低哑", "滚烫", "受不了", "抱紧", "共振",
];
const MID_INTENSITY_WORDS = [
  "呼吸", "心跳", "指尖", "靠近", "耳边", "温度", "贴", "手腕", "腰",
  "掌心", "微热", "低声", "鼻音", "眼神", "凝视", "怀里",
];
const CALM_WORDS = [
  "平复", "缓过", "安静", "歇", "余温", "睡", "慢慢落", "松快", "晚风", "雨停",
];

/**
 * 根据小说段落文本内容与所在章节位置，自动推断 0..100 震动强度与波形。
 */
export function analyzeParagraphIntensity(text, index = 0, total = 1) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { intensity: 20, wave: "feather", phaseLabel: "轻柔铺垫" };
  }
  const countMatches = (words) => words.reduce((acc, w) => acc + (raw.includes(w) ? 1 : 0), 0);
  const highHits = countMatches(HIGH_INTENSITY_WORDS);
  const midHits = countMatches(MID_INTENSITY_WORDS);
  const calmHits = countMatches(CALM_WORDS);
  const ellipsisCount = (raw.match(/……|\.\.\./g) || []).length;

  const progress = total > 1 ? index / (total - 1) : 0.5;
  const isEnding = total >= 3 && index === total - 1;

  if (isEnding && calmHits >= 1 && highHits <= 1) {
    return {
      intensity: clampIntensity(18 + calmHits * 2),
      wave: "afterglow",
      phaseLabel: "余温平复",
    };
  }

  // 基础弧线：前段 22 -> 中段 55 -> 后段 75 -> 尾段回落
  let arcBase = 24;
  if (progress < 0.25) arcBase = 20 + Math.round(progress * 60);
  else if (progress < 0.75) arcBase = 38 + Math.round((progress - 0.25) * 70);
  else if (progress < 0.92) arcBase = 72;
  else arcBase = 28;

  let score = arcBase + highHits * 9 + midHits * 4 + Math.min(8, ellipsisCount * 3) - calmHits * 7;
  score = Math.max(12, Math.min(92, score));

  let wave = "feather";
  let phaseLabel = "初遇铺垫";
  if (score >= 72) {
    wave = "climb";
    phaseLabel = "共振顶点";
  } else if (score >= 50) {
    wave = "wave";
    phaseLabel = "呼吸交叠";
  } else if (score >= 32) {
    wave = "pulse";
    phaseLabel = "耳畔微热";
  } else if (isEnding || calmHits >= 2) {
    wave = "afterglow";
    phaseLabel = "余温平复";
  }

  return {
    intensity: clampIntensity(score),
    wave,
    phaseLabel,
  };
}

/**
 * 将用户上传或粘贴的小说文本切分为带 0..100 强度与波形标注的章节段落。
 */
export function parseNovelTextToStory(title, rawText, personaId = "gentle", personaName = "伴侣") {
  const clean = String(rawText || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (!clean) throw new Error("小说内容不能为空");
  if (clean.length > 100_000) throw new Error("文件过大，请控制在 10 万字以内");

  const blocks = clean
    .split(/\n{2,}/)
    .flatMap((block) => {
      const trimmed = block.trim();
      if (trimmed.length <= 260) return [trimmed];
      return trimmed.split(/\n/).map((line) => line.trim()).filter(Boolean);
    })
    .filter(Boolean);

  // 仅合并过短的碎片单句（< 36 字），保留用户明确的空行分段
  const merged = [];
  let buffer = "";
  for (const line of blocks) {
    if (!buffer) {
      buffer = line;
    } else if (buffer.length < 16 && buffer.length + line.length < 50) {
      buffer += `\n${line}`;
    } else {
      merged.push(buffer);
      buffer = line;
    }
  }
  if (buffer) merged.push(buffer);

  const paragraphs = merged.slice(0, 40);
  const total = paragraphs.length;
  const segments = paragraphs.map((p, idx) => {
    const analyzed = analyzeParagraphIntensity(p, idx, total);
    return {
      title: `第 ${idx + 1} 段 · ${analyzed.phaseLabel}`,
      phaseLabel: analyzed.phaseLabel,
      intensity: analyzed.intensity,
      wave: analyzed.wave,
      text: p,
    };
  });

  const safeTitle = String(title || "").trim().slice(0, 40) || "导入的私密故事";
  return {
    id: `custom-novel-${Date.now().toString(36)}`,
    title: safeTitle,
    personaId: personaId || "gentle",
    personaName: personaName || "TA",
    subtitle: `自定义导入 · 共 ${segments.length} 段随动章节`,
    tags: ["自定义导入", "智能随动"],
    custom: true,
    segments,
  };
}

/** 小说随动脉冲频率：1 最慢，10 最快。默认 6 约等于原先固定的 220ms 一步。 */
export const NOVEL_FREQ_MIN = 1;
export const NOVEL_FREQ_MAX = 10;
export const NOVEL_FREQ_DEFAULT = 6;

const NOVEL_FREQ_SLOW_MS = 800;
const NOVEL_FREQ_FAST_MS = 80;

export function clampNovelFrequency(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return NOVEL_FREQ_DEFAULT;
  return Math.min(NOVEL_FREQ_MAX, Math.max(NOVEL_FREQ_MIN, Math.round(n)));
}

/**
 * 把用户拖动的频率档换成波形一步的间隔（毫秒）。
 * 档位越高，间隔越短，起伏越密。1 档 800ms，10 档 80ms，中间按对数拉开。
 */
export function novelFrequencyToInterval(level) {
  const lv = clampNovelFrequency(level);
  const t = (lv - 1) / (NOVEL_FREQ_MAX - NOVEL_FREQ_MIN);
  const ratio = NOVEL_FREQ_FAST_MS / NOVEL_FREQ_SLOW_MS;
  return Math.round(NOVEL_FREQ_SLOW_MS * Math.pow(ratio, t));
}

/**
 * 情景对话授权之后的硬件节奏。频率档沿用阅读页的 1–10，
 * 间隔不会短过设备链路的发送节流。
 */
export const SCENARIO_HARDWARE_PULSE = Object.freeze({
  approaching: { frequency: 3, wave: "feather" },
  rising: { frequency: 6, wave: "wave" },
  climax_window: { frequency: 7, wave: "climb" },
  aftercare: { frequency: 2, wave: "afterglow" },
});

export function scenarioHardwarePulse(phase) {
  const spec = SCENARIO_HARDWARE_PULSE[phase] || SCENARIO_HARDWARE_PULSE.approaching;
  return {
    wave: spec.wave,
    intervalMs: Math.max(QINGNAN17_THROTTLE_MS, novelFrequencyToInterval(spec.frequency)),
  };
}

/** 阅读页频率条旁的中文说明，例如「适中 · 约 4.5 次/秒」。 */
export function novelFrequencyCaption(level) {
  const lv = clampNovelFrequency(level);
  const pace = lv <= 2 ? "很慢" : lv <= 4 ? "偏慢" : lv <= 6 ? "适中" : lv <= 8 ? "偏快" : "很快";
  const perSec = Math.round((1000 / novelFrequencyToInterval(lv)) * 10) / 10;
  return `${pace} · 约 ${perSec} 次/秒`;
}

/**
 * 计算当前时刻波形调制后的动态强度（0..100）。
 */
export function computeNovelWaveIntensity(baseIntensity, waveId = "wave", tick = 0) {
  const base = clampIntensity(baseIntensity);
  if (base <= 0) return 0;
  const wave = NOVEL_WAVES[waveId] || NOVEL_WAVES.wave;
  const offsets = wave.offsets;
  const offset = offsets[Math.abs(Math.floor(tick)) % offsets.length] || 0;
  // 按基础强度比例缩放波动幅度，低强度时更细腻
  const scale = base < 25 ? 0.6 : 1.0;
  const modulated = Math.round(base + offset * scale);
  return Math.max(5, Math.min(100, modulated));
}

/**
 * 离线或未配置大模型时的本地小说续写回退生成器（贴合人设与所选情绪走向）。
 */
export function buildStubNovelContinuation(story, directionId = "closer", customHint = "") {
  const dir = NOVEL_CONTINUE_DIRECTIONS.find((d) => d.id === directionId) || NOVEL_CONTINUE_DIRECTIONS[0];
  const name = story?.personaName || "他";
  const hintText = String(customHint || "").trim();
  const prefix = hintText ? `顺着「${hintText.slice(0, 24)}」的心思，` : "";

  const templates = {
    closer: `${prefix}夜色似乎又往屋里漫进了几分。${name}没有急着说话，只是顺着你呼吸的频率，把掌心稳稳贴在了你的后腰上。隔着薄薄的衣料，那股温热的力道一点点渗透进来，连同耳畔越来越近的吐息，把周围所有的声音都轻轻推远了。`,
    tease: `${prefix}${name}察觉到了你指尖细微的蜷缩，却故意停顿了两秒才低笑出声。温热的气息若有似无地擦过你的耳垂，像羽毛在心口最敏锐的地方轻轻扫了一下：「怎么不说话了……是觉得现在这样刚好，还是想让我再近一点？」`,
    climax: `${prefix}最后一丝克制也在交叠的呼吸里融化殆尽。${name}的手臂收得很紧，滚烫的呼吸紧贴着你的颈侧同频起伏，连叫你名字的声音都带上了难以自持的微哑：「别忍着，抓紧我……不管这阵浪有多深，我都陪着你一起过去。」`,
    aftercare: `${prefix}急促的潮水渐渐退回平静的海面。${name}把动作放得极轻，替你拢了拢被角，手指一下一下轻柔地顺着你的后背抚平余颤，用近乎气音的温柔低语问你：「缓过来了吗？先闭上眼歇口气，想让我继续抱着你，还是安静待一会儿，都听你的。」`,
  };

  return {
    title: `续章 · ${dir.label.replace(/（.*）/, "")}`,
    phaseLabel: dir.label.replace(/.*（|）/g, "") || "互动续写",
    intensity: dir.targetIntensity,
    wave: dir.wave,
    text: templates[dir.id] || templates.closer,
    tts_style: dir.id === "climax" ? "着急" : dir.id === "tease" ? "俏皮" : dir.id === "aftercare" ? "低语" : "温柔",
    stub: true,
  };
}

export function loadCustomNovels(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!storage) return [];
  try {
    const raw = JSON.parse(storage.getItem(NOVEL_STORE_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveCustomNovels(novels, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  if (!storage) return;
  try {
    storage.setItem(NOVEL_STORE_KEY, JSON.stringify(novels.slice(0, 20)));
  } catch {
    /* ignore */
  }
}
