import * as React from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Card, CardContent } from "@/components/ui/card";
import { StarsBackground } from "@/components/animate-ui/stars-background";

const SLIDES = [
  {
    title: "Welcome",
    description: "An introduction to the slide carousel experience.",
    bg: "from-indigo-600 to-violet-700",
  },
  {
    title: "Design",
    description: "Beautiful interfaces built with care and attention.",
    bg: "from-rose-500 to-pink-700",
  },
  {
    title: "Develop",
    description: "Clean code, tested and ready for production.",
    bg: "from-emerald-500 to-teal-700",
  },
  {
    title: "Deploy",
    description: "Ship fast with confidence and reliability.",
    bg: "from-amber-500 to-orange-700",
  },
  {
    title: "Iterate",
    description: "Measure, learn, and continuously improve.",
    bg: "from-cyan-500 to-blue-700",
  },
];

export default function SlidesPage() {
  const [api, setApi] = React.useState<CarouselApi>();
  const [current, setCurrent] = React.useState(0);

  React.useEffect(() => {
    if (!api) return;

    const onSelect = () => setCurrent(api.selectedScrollSnap());

    setCurrent(api.selectedScrollSnap());
    api.on("select", onSelect);
    return () => { api.off("select", onSelect); };
  }, [api]);

  return (
    <StarsBackground
      className="min-h-screen"
      starColor="#a5b4fc"
      speed={80}
      pointerEvents={false}
    >
      <div
        className="relative z-10 flex min-h-screen flex-col items-center justify-center p-8"
        data-testid="slides-page"
      >
        <p
          className="mb-4 text-sm font-medium uppercase tracking-widest text-white/50"
          data-testid="slides-current"
        >
          Slide {current + 1} of {SLIDES.length}
        </p>

        <Carousel
          setApi={setApi}
          className="w-full max-w-lg select-none"
          data-testid="slides-track"
        >
          <CarouselContent>
            {SLIDES.map((s, i) => (
              <CarouselItem key={i}>
                <Card className="border-0 bg-transparent shadow-none">
                  <CardContent className="p-0">
                    <div
                      className={`rounded-2xl bg-gradient-to-br ${s.bg} p-10 shadow-2xl`}
                    >
                      <h2
                        className="mb-3 text-4xl font-bold text-white"
                        data-testid={`slides-title-${i}`}
                      >
                        {s.title}
                      </h2>
                      <p className="text-lg leading-relaxed text-white/80">
                        {s.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </CarouselItem>
            ))}
          </CarouselContent>

          <CarouselPrevious data-testid="slides-prev" />
          <CarouselNext data-testid="slides-next" />
        </Carousel>

        {/* Dot indicators */}
        <div className="mt-6 flex gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => api?.scrollTo(i)}
              data-testid={`slides-dot-${i}`}
              className={`h-2.5 w-2.5 rounded-full transition-all ${
                i === current
                  ? "scale-125 bg-white"
                  : "bg-white/30 hover:bg-white/60"
              }`}
            />
          ))}
        </div>
      </div>
    </StarsBackground>
  );
}
