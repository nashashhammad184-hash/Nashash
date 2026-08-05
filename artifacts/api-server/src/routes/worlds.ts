import { Router, type IRouter } from "express";
import { ListWorldsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const WORLDS = [
  {
    id: "noir",
    nameAr: "عالم الغموض والتحقيق",
    nameEn: "Noir",
    description: "عالم مظلم مليء بالأسرار والتحقيقات الجنائية، حيث تتشابك الظلال مع الحقيقة في شوارع المدن الباردة.",
  },
  {
    id: "scifi",
    nameAr: "العالم المستقبلي",
    nameEn: "Sci-Fi",
    description: "مستقبل مجهول تتحكم فيه التكنولوجيا والذكاء الاصطناعي، حيث يتساءل الإنسان عن معنى الوجود والإنسانية.",
  },
  {
    id: "history",
    nameAr: "العالم التاريخي والقديم",
    nameEn: "History",
    description: "رحلة عبر الزمن إلى حضارات عريقة وممالك منسية، حيث تُكتب الأساطير بدماء الأبطال ودموع الشهداء.",
  },
  {
    id: "fantasy",
    nameAr: "العالم الأسطوري والفانتازيا",
    nameEn: "Fantasy",
    description: "عوالم سحرية تسكنها الجن والتنانين والسحرة، حيث لا تعرف الخيال حدوداً والمغامرة لا تنتهي أبداً.",
  },
  {
    id: "drama",
    nameAr: "العالم الواقعي والدراما الاجتماعية",
    nameEn: "Drama",
    description: "قصص من صميم الحياة اليومية تكشف عن الصراعات الإنسانية العميقة، العائلة، الحب، الخيانة، والكفاح.",
  },
];

router.get("/worlds", async (_req, res): Promise<void> => {
  res.json(ListWorldsResponse.parse(WORLDS));
});

export default router;
export { WORLDS };
