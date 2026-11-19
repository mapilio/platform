import dynamic from "next/dynamic";
import {CustomMeta} from "helper";
import {seoConfig} from "Configs/seoConfig";

const Walk = dynamic(() => import("views/platformApp/Walk/Walk"), { ssr: false });

export default function WalkPage() {
  return (
    <>
      <CustomMeta
        title="Mapilio | Walk the street"
        description="Walk any street captured by Mapilio contributors: drag to look around, click the ground to move, or drive along the sequence."
        image={seoConfig.app.image}
      />
      <Walk />
    </>
  );
}
