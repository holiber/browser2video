import { useState } from 'react'

const slides = [
  { bg: 'from-blue-500 to-purple-600', title: 'Mountain View' },
  { bg: 'from-emerald-500 to-teal-600', title: 'Forest Trail' },
  { bg: 'from-orange-500 to-red-600', title: 'Desert Sunset' },
  { bg: 'from-pink-500 to-rose-600', title: 'Cherry Blossom' },
]

export default function App() {
  const [current, setCurrent] = useState(0)
  const prev = () => setCurrent((current - 1 + slides.length) % slides.length)
  const next = () => setCurrent((current + 1) % slides.length)

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="relative w-[700px] overflow-hidden rounded-2xl shadow-2xl">
        <div className="flex transition-transform duration-500"
             style={{ transform: `translateX(-${current * 100}%)` }}>
          {slides.map((s, i) => (
            <div key={i} className={`w-full flex-shrink-0 h-[400px] bg-gradient-to-br ${s.bg} flex items-center justify-center`}>
              <h2 className="text-white text-4xl font-bold drop-shadow-lg">{s.title}</h2>
            </div>
          ))}
        </div>
        <button onClick={prev} className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/30 hover:bg-white/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl backdrop-blur">&lsaquo;</button>
        <button onClick={next} className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/30 hover:bg-white/60 text-white rounded-full w-10 h-10 flex items-center justify-center text-xl backdrop-blur">&rsaquo;</button>
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {slides.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)}
              className={`w-3 h-3 rounded-full transition-colors ${i === current ? 'bg-white' : 'bg-white/40'}`} />
          ))}
        </div>
      </div>
    </div>
  )
}
