"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import {
  ArrowRight,
  ChevronDown,
  CircleCheck,
  CreditCard,
  Download,
  Eye,
  Globe,
  Image as ImageIcon,
  Layers3,
  Maximize,
  PanelsTopLeft,
  PenTool,
  Shirt,
  Sparkles,
  SquarePen,
  Target,
  Upload,
  WandSparkles,
  Zap,
} from "lucide-react"
import {
  fetchCachedPublicSystemSettings,
  formatDesignPlatformName,
  normalizePublicAppName,
} from "@/lib/client/public-system-settings"
import ProductDetailShell from "@/components/picset/product-detail-shell"

const NAV_ITEMS = [
  { href: "/studio-genesis", label: "全品类商品图", icon: Layers3 },
  { href: "/aesthetic-mirror", label: "风格复刻", icon: ImageIcon },
  { href: "/clothing-studio", label: "服装组图", icon: Shirt },
  { href: "/refinement-studio", label: "图片精修", icon: WandSparkles },
  { href: "/canvas-studio", label: "万能画布", icon: PenTool, badge: "公测" },
  { href: "/pricing?return_to=%2Fstudio-genesis", label: "套餐价格", icon: CreditCard },
] as const

const FEATURE_SECTIONS = [
  {
    title: "全品类商品图",
    subtitle: "一键生成完整的电商详情图组",
    description:
      "上传产品图，AI 自动分析产品特征，智能规划详情页结构，批量生成多张高质量详情图。支持自定义尺寸、风格和数量，满足不同电商平台需求。",
    bullets: ["智能分析产品卖点", "自动规划详情页结构", "批量生成多张图片"],
    href: "/studio-genesis/workspace",
    cta: "开始全品类商品图",
    mediaTitle: "全品类商品图",
    mediaType: "iframe" as const,
    mediaSrc: "https://cdn.picsetai.cn/uploads/videos/tutorial/089847d6-2188-4e4f-8550-f400b76d31b3.mp4",
    icon: Layers3,
    iconClassName: "bg-primary/10 text-primary",
    reverse: false,
  },
  {
    title: "风格复刻",
    subtitle: "克隆爆款详情图的设计风格",
    description:
      "上传参考图和产品图，AI 深度分析参考图的设计语言、配色方案和排版风格，将其精准应用到您的产品上，快速生成同风格的详情图。",
    bullets: ["深度分析设计语言", "精准复刻配色方案", "保持品牌一致性"],
    href: "/aesthetic-mirror",
    cta: "开始风格复刻",
    mediaTitle: "风格复刻",
    mediaType: "iframe" as const,
    mediaSrc: "https://cdn.picsetai.cn/uploads/videos/tutorial/ff2fdec5-91ba-4eff-96b6-4aee05d60760.mp4",
    icon: ImageIcon,
    iconClassName: "bg-secondary/50 text-foreground",
    reverse: true,
  },
  {
    title: "服装套图生成",
    subtitle: "一键批量生成模特试穿套图与基础套图",
    description:
      "上传产品图，AI 自动解析服装版型、面料与设计细节，智能生成模特试穿场景图、白底图、人台图、3D 立体图、细节图及卖点图，全程保持视觉风格与产品特征的高度一致性。",
    bullets: [
      "智能解析服装版型与面料细节",
      "一键生成模特试穿与基础套图",
      "保持视觉风格与产品特征高度一致",
      "适配多平台展示需求",
    ],
    href: "/clothing-studio",
    cta: "开始服装套图生成",
    mediaTitle: "服装套图生成",
    mediaType: "video" as const,
    mediaSrc: "https://cdn.picsetai.cn/uploads/videos/tutorial/129c5470-8ba1-4201-82e0-76c36b0d43cc.mp4",
    icon: Shirt,
    iconClassName: "bg-primary/10 text-primary",
    reverse: false,
  },
  {
    title: "批量精修",
    subtitle: "批量处理不同类型产品的精修任务",
    description:
      "上传多品类产品图，系统自动分析每个产品的材质、光影与瑕疵问题，逐一完成专业级精修，包括瑕疵修复、色彩校正、质感提升与背景优化。",
    bullets: [
      "自动分析不同产品的精修需求",
      "批量完成瑕疵修复与质感提升",
      "保持多产品精修效果的统一性",
      "大幅提升批量处理效率",
    ],
    href: "/refinement-studio",
    cta: "开始批量精修",
    mediaTitle: "批量精修",
    mediaType: "video" as const,
    mediaSrc: "https://cdn.picsetai.cn/uploads/videos/tutorial/a9b7e5fb-b335-420f-b8a1-ad670be16538.mp4",
    icon: WandSparkles,
    iconClassName: "bg-secondary/50 text-foreground",
    reverse: true,
  },
] as const

const PROCESS_STEPS = [
  {
    step: "第 1 步",
    title: "上传产品图",
    description: "上传您的产品图片，支持 JPG、PNG 等常见格式",
    icon: Upload,
  },
  {
    step: "第 2 步",
    title: "AI 智能分析",
    description: "AI 自动识别产品特征，规划详情图内容结构",
    icon: Sparkles,
  },
  {
    step: "第 3 步",
    title: "一键生成",
    description: "批量生成高质量详情图，支持下载和二次编辑",
    icon: Zap,
  },
] as const

const TECH_FEATURES = [
  { title: "智能卖点提取", description: "AI 自动识别产品核心卖点，精准提炼文案要素", icon: Target },
  { title: "专业排版引擎", description: "自动生成符合电商规范的专业版式设计", icon: PanelsTopLeft },
  { title: "一致性保障", description: "确保系列图片风格统一，品牌调性一致", icon: CircleCheck },
  { title: "批量处理", description: "一次生成多张详情图，大幅提升工作效率", icon: Layers3 },
  { title: "物理级光影重建", description: "哪怕是仓库随手拍，AI 也能重塑 3D 摄影棚级的光效。", icon: Sparkles },
  { title: "多语言支持", description: "支持中英文等多种语言，助力跨境电商", icon: Globe },
  { title: "即时预览", description: "实时查看生成效果，快速迭代优化", icon: Eye },
  { title: "高清输出", description: "支持多种分辨率导出，满足各平台要求", icon: Download },
  { title: "自定义尺寸", description: "灵活调节图片尺寸比例，适配各电商平台", icon: Maximize },
  { title: "二次编辑", description: "生成后可继续调整优化，精细打磨每个细节", icon: SquarePen },
  { title: "风格迁移", description: "智能学习爆款设计风格，一键应用到新产品", icon: Sparkles },
  { title: "极速生成", description: "优化算法加速，数分钟完成整套详情图", icon: Zap },
] as const

const WHY_PICSET = [
  {
    title: "请设计师太贵？",
    description: "一个人顶一个设计部，Picset 把设计成本降至近乎为零。",
  },
  {
    title: "外包沟通太累？",
    description: "创意即见即所得，无需反复修改，几分钟完成原本一周的工作量。",
  },
  {
    title: "排版文案太难？",
    description: "从设计语言、色彩规划到卖点文案排布，AI 全流程代劳。",
  },
] as const

const CASE_IMAGES = [
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1618331835717-801e976710b2?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1560343090-f0409e92791a?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1586495777744-4413f21062fa?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1585237672814-8f85a8118bf6?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1560769629-975ec94e6a86?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1491637639811-60e2756cc1c7?w=400&h=500&fit=crop",
  "https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=400&h=500&fit=crop",
] as const

const FAQ_ITEMS = [
  {
    question: "通过 Picset 生成的图片，版权归谁所有？",
    answer:
      "归你所有。你拥有 Picset 生成的所有图片的 100% 所有权。你可以自由地将这些图片用于任何平台的商业用途，无需署名或额外授权。",
  },
  {
    question: "AI 生成图片时，会改变我产品的真实外观吗？",
    answer:
      "完全不会。我们自研的“主体完整性（Subject Integrity）”算法会严格锁定产品的物理结构、颜色和 Logo。AI 仅重构产品周围的环境场景与光影效果，确保产品本身 100% 真实还原。",
  },
  {
    question: "使用这款工具，我需要专业的摄影或设计技能吗？",
    answer:
      "完全不需要。Picset 专为非设计人员打造。只要你能用手机拍出一张清晰的产品原图，剩下的复杂打光、抠图去背和美化排版，AI 都能为你一键搞定。",
  },
  {
    question: "生成的图片符合亚马逊（Amazon）或 Shopify 等平台的标准吗？",
    answer:
      "是的。我们内置了针对 Amazon A+ 内容、Shopify、TikTok Shop 和 Etsy 优化的预设比例与分辨率。导出的每张图片均支持最高 4K 高清画质，可直接上架使用。",
  },
  {
    question: "相比聘请美工或设计外包，Picset 有什么优势？",
    answer:
      "极致的效率与成本。传统外包可能需要数天交付，而 Picset 仅需几秒即可生成数十种摄影棚级的设计方案，且成本几乎可以忽略不计。这能帮你大幅提升测款速度，随时调整营销策略。",
  },
  {
    question: "Picset 的目标用户群体是谁？",
    answer:
      "Picset 专为小型电商团队和独立卖家量身打造。我们通过 AI 技术赋能，帮助你在无需聘请专职设计团队或支付昂贵外包费用的前提下，也能获得行业顶尖的视觉设计水准。",
  },
] as const

function FaqItem({
  item,
  open,
  onToggle,
}: {
  item: (typeof FAQ_ITEMS)[number]
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-300">
      <button type="button" onClick={onToggle} className="w-full text-left p-6 flex items-center justify-between group">
        <div className="flex items-center gap-4">
          <span className="h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors bg-primary/10 text-primary">
            Q
          </span>
          <h3 className="text-lg font-bold text-foreground">{item.question}</h3>
        </div>
        <div className="h-8 w-8 rounded-full flex items-center justify-center transition-all duration-300 bg-muted/50 text-muted-foreground">
          <ChevronDown className={`w-5 h-5 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      <div className={`transition-all duration-300 ease-in-out ${open ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="px-6 pb-6 pt-2 ml-12">
          <p className="text-muted-foreground text-sm leading-relaxed">{item.answer}</p>
        </div>
      </div>
    </div>
  )
}

export default function StudioGenesisLandingPage() {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null)
  const [siteName, setSiteName] = useState(() => normalizePublicAppName(""))

  useEffect(() => {
    let cancelled = false

    fetchCachedPublicSystemSettings()
      .then((settings) => {
        if (!cancelled) {
          setSiteName(normalizePublicAppName(settings.appName))
        }
      })
      .catch((error) => {
        console.warn("[studio-genesis] failed to load public system settings:", error)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const designPlatformName = formatDesignPlatformName(siteName)

  return (
    <ProductDetailShell>
      <main className="min-h-screen bg-background selection:bg-primary selection:text-primary-foreground">
      <section className="py-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground mb-6">
            {designPlatformName}：你的 AI 电商视觉专家
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            让小团队也有大牌设计力。支持智能全品类商品图和风格复刻，让您的商品脱颖而出。
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-12 text-base rounded-xl px-8"
              href="/studio-genesis/workspace"
            >
              免费试用
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] border border-border bg-surface text-foreground hover:bg-surface-hover h-12 text-base rounded-xl px-8"
            >
              查看演示
            </a>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 bg-muted/30" id="features">
        <div className="max-w-6xl mx-auto space-y-16">
          {FEATURE_SECTIONS.map((section) => {
            const Icon = section.icon
            const textOrderClassName = section.reverse ? "order-1 lg:order-2" : ""
            const mediaOrderClassName = section.reverse ? "order-2 lg:order-1" : ""

            return (
              <div key={section.title} className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                <div className={`${textOrderClassName} bg-card border border-border rounded-2xl p-8 shadow-sm`}>
                  <div className="flex items-center gap-4 mb-6">
                    <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${section.iconClassName}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-foreground">{section.title}</h3>
                      <p className="text-muted-foreground">{section.subtitle}</p>
                    </div>
                  </div>
                  <p className="text-muted-foreground mb-6">{section.description}</p>
                  <ul className="space-y-2 mb-8">
                    {section.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Sparkles className="w-4 h-4 text-primary" />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                  <Link
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm h-10 px-5 py-2 rounded-xl"
                    href={section.href}
                  >
                    {section.cta}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </div>

                <div className={mediaOrderClassName}>
                  <div className="aspect-video rounded-xl overflow-hidden border border-border shadow-sm">
                    {section.mediaType === "iframe" ? (
                      <iframe
                        src={section.mediaSrc}
                        title={section.mediaTitle}
                        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                      />
                    ) : (
                      <video
                        src={section.mediaSrc}
                        title={section.mediaTitle}
                        controls
                        loop
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-4">三步完成详情图生成</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">简单直观的操作流程，让 AI 为您完成繁琐的设计工作</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {PROCESS_STEPS.map((step) => {
              const Icon = step.icon
              return (
                <div key={step.title} className="text-center">
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
                    <Icon className="w-8 h-8 text-primary" />
                  </div>
                  <div className="text-sm font-medium text-primary mb-2">{step.step}</div>
                  <h3 className="text-xl font-bold text-foreground mb-2">{step.title}</h3>
                  <p className="text-muted-foreground text-sm">{step.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-4">技术亮点</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              融合多项前沿AI技术，为您的电商业务提供专业级图片生成能力
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {TECH_FEATURES.map((feature) => {
              const Icon = feature.icon
              return (
                <div key={feature.title} className="bg-card border border-border rounded-xl p-6 text-center hover:shadow-md transition-shadow">
                  <Icon className="w-8 h-8 text-primary mx-auto mb-4" />
                  <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-xs text-muted-foreground">{feature.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 bg-background">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-4">为什么选择 Picset?</h2>
            <p className="text-muted-foreground text-lg">
              让小团队也有大牌设计力。支持智能全品类商品图和风格复刻，让您的商品脱颖而出。
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {WHY_PICSET.map((item) => (
              <div key={item.title} className="bg-muted/50 p-8 rounded-3xl border border-border hover:border-primary/30 transition-all hover:shadow-lg group">
                <h3 className="text-xl font-bold text-foreground mb-4 group-hover:text-primary transition-colors">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-4">案例展示</h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              由 AI 生成的电商详情图示例，涵盖多种产品类型和设计风格
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {CASE_IMAGES.map((src, index) => (
              <div key={`${src}-${index}`} className="aspect-[3/4] rounded-xl overflow-hidden border border-border bg-muted/30 hover:shadow-lg transition-all duration-300 hover:scale-[1.02]">
                <img src={src} alt="电商详情图示例" className="w-full h-full object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 bg-muted/30" id="faq">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-4">常见问题</h2>
            <p className="text-muted-foreground text-lg">了解 Picset 如何助力您的电商业务</p>
          </div>
          <div className="grid grid-cols-1 gap-6">
            {FAQ_ITEMS.map((item, index) => (
              <FaqItem
                key={item.question}
                item={item}
                open={openFaqIndex === index}
                onToggle={() => setOpenFaqIndex((current) => (current === index ? null : index))}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 bg-primary text-primary-foreground">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-4">准备好提升您的电商视觉效果了吗？</h2>
          <p className="text-primary-foreground/80 text-lg mb-8">立即开始使用{designPlatformName} 为您创造更多可能</p>
          <Link
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98] bg-secondary text-secondary-foreground hover:bg-secondary/80 h-12 text-base rounded-xl px-8"
            href="/studio-genesis/workspace"
          >
            免费试用
            <ArrowRight className="w-4 h-4 ml-2" />
          </Link>
        </div>
      </section>

      <footer className="py-8 px-4 sm:px-6 border-t border-border">
        <div className="max-w-5xl mx-auto flex flex-col gap-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-primary flex items-center justify-center shadow-sm">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground">{designPlatformName}</span>
            </div>
            <nav className="flex items-center gap-6">
              <a className="text-sm text-muted-foreground hover:text-foreground transition-colors" href="/join-us">
                关于我们
              </a>
              <a className="text-sm text-muted-foreground hover:text-foreground transition-colors" href="/terms">
                服务条款
              </a>
              <a className="text-sm text-muted-foreground hover:text-foreground transition-colors" href="/privacy">
                隐私政策
              </a>
            </nav>
          </div>
          <p className="text-sm text-muted-foreground text-center sm:text-left">
            © 2026 {siteName} 版权所有。 ·{" "}
            <Link href="/" className="hover:text-foreground transition-colors">
              {siteName}
            </Link>
          </p>
        </div>
      </footer>
      </main>
    </ProductDetailShell>
  )
}
