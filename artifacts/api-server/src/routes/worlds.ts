import { Router, type IRouter } from "express";
import { ListWorldsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const WORLDS = [
  {
    id: "noir",
    nameAr: "عالم الغموض والتحقيق",
    nameEn: "Mystery & Crime",
    description: "عالم مليء بالأسرار والتحقيقات والجريمة، حيث تتشابك الأدلة مع الخداع والحقيقة.",
  },
  {
    id: "history",
    nameAr: "العالم التاريخي والقديم",
    nameEn: "Historical & Ancient",
    description: "حضارات وممالك وعصور تاريخية قديمة، مع أجواء واقعية مستوحاة من الماضي.",
  },
  {
    id: "contemporary",
    nameAr: "العالم المعاصر",
    nameEn: "Contemporary",
    description: "العصر الحالي بكل تفاصيله من مدن وحياة يومية وتقنيات ومجتمعات معاصرة.",
  },
  {
    id: "scifi",
    nameAr: "العالم المستقبلي",
    nameEn: "Sci-Fi & Future",
    description: "مستقبل متطور تتحكم فيه التكنولوجيا والذكاء الاصطناعي والابتكارات الجديدة.",
  },
  {
    id: "fantasy",
    nameAr: "عالم الفانتازيا والأساطير",
    nameEn: "Fantasy & Mythology",
    description: "عوالم سحرية وأساطير ومخلوقات خيالية وممالك لا تحدها قوانين الواقع.",
  },
  {
    id: "drama",
    nameAr: "عالم الدراما الاجتماعية",
    nameEn: "Social Drama",
    description: "قصص واقعية عن العلاقات والعائلة والحب والخيانة والصراعات الإنسانية.",
  },
  {
    id: "stories",
    nameAr: "عالم القصص والروايات",
    nameEn: "Stories & Narration",
    description: "قصص يرويها الراوي، ويمكن أن تكون مبنية على أحداث حقيقية أو من نسج الخيال.",
  },
  {
    id: "children",
    nameAr: "عالم الأطفال",
    nameEn: "Children",
    description: "قصص ومغامرات مناسبة للأطفال مع شخصيات وأحداث وأجواء مرحة وآمنة.",
  },
  {
    id: "cartoon",
    nameAr: "عالم الشخصيات الكرتونية",
    nameEn: "Cartoon & Animation",
    description: "عالم مخصص لإنتاج القصص والمشاهد باستخدام الشخصيات الكرتونية والرسوم المتحركة.",
  },
  {
    id: "advertising",
    nameAr: "عالم الدعاية والإعلان",
    nameEn: "Advertising",
    description: "إنتاج الإعلانات التجارية والترويجية للمنتجات والخدمات والعلامات التجارية.",
  },
];

router.get("/worlds", async (_req, res): Promise<void> => {
  res.json(ListWorldsResponse.parse(WORLDS));
});

export default router;
export { WORLDS };
