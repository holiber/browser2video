/**
 * @description Simplified Wikipedia-style article about Armillaria ostoyae.
 * Used by the chat scenario — Bob reads this on his Pixel phone.
 */

const TAXONOMY = [
  { label: "Kingdom", value: "Fungi", link: true },
  { label: "Division", value: "Basidiomycota", link: true },
  { label: "Order", value: "Agaricales", link: true },
  { label: "Family", value: "Physalacriaceae", link: true },
  { label: "Genus", value: "Armillaria", link: true, italic: true },
  { label: "Species", value: "A.\u00a0ostoyae", bold: true, italic: true },
] as const;

export default function WikiPage() {
  return (
    <div
      className="flex flex-col h-full bg-white text-gray-900 select-none"
      data-testid="wiki-page"
    >
      <div className="flex-1 overflow-y-auto">
        {/* Wikipedia header bar */}
        <div className="flex items-center gap-2.5 px-4 py-2 border-b border-gray-200 bg-white sticky top-0 z-10">
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-gray-800" fill="currentColor">
            <path d="M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029C6.677 16.56 3.706 9.448 2.453 6.678c-.413-.917-.252-.937.372-.937h2.688c.474 0 .663.08.86.517.736 1.643 3.84 8.572 4.284 9.565.189-.424 1.272-2.623 2.16-4.476L11.4 8.6c-.282-.56-.084-.958.456-.958h2.4c.38 0 .56.082.76.518l2.264 5.14 4.26-9.622c.2-.437.38-.518.76-.518h2.328c.624 0 .784.02.372.937-1.254 2.77-5.382 11.864-6.41 14.198-.404.902-.916 1.045-1.532-.03-.636-1.18-1.917-3.795-2.852-5.728z"/>
          </svg>
          <span className="text-sm font-medium text-gray-600">Wikipedia</span>
        </div>

        <div className="px-4 py-3">
          {/* Article title */}
          <h1
            className="text-[22px] font-serif font-normal text-gray-900 border-b border-gray-200 pb-2 mb-1"
            data-testid="wiki-title"
          >
            <i>Armillaria ostoyae</i>
          </h1>
          <p className="text-xs text-gray-500 mb-4">
            From Wikipedia, the free encyclopedia
          </p>

          {/* Infobox */}
          <div className="float-right ml-3 mb-3 w-44 border border-gray-300 bg-gray-50 text-xs rounded-sm overflow-hidden">
            <div className="bg-gray-200 px-2 py-1.5 text-center font-semibold italic">
              Armillaria ostoyae
            </div>
            <div className="h-24 bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center">
              <span className="text-5xl" role="img" aria-label="mushroom">🍄</span>
            </div>
            <div className="bg-gray-200 px-2 py-1 text-center text-[10px] font-medium">
              Scientific classification
            </div>
            <table className="w-full text-[11px]">
              <tbody>
                {TAXONOMY.map((row) => (
                  <tr key={row.label} className="border-t border-gray-200">
                    <td className="px-2 py-0.5 font-semibold text-right w-20 align-top">
                      {row.label}:
                    </td>
                    <td className="px-2 py-0.5">
                      <span className={`${row.link ? "text-blue-700" : ""} ${row.italic ? "italic" : ""} ${row.bold ? "font-bold" : ""}`}>
                        {row.value}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Lead paragraph */}
          <p className="text-[13px] leading-[1.7] text-gray-800 mb-3" data-testid="wiki-intro">
            <b><i>Armillaria ostoyae</i></b> (synonym <b><i>A.&nbsp;solidipes</i></b>) is a
            species of pathogenic fungus in the family Physalacriaceae. The mycelium invades the
            sapwood of trees and is able to disseminate over great distances under the bark or
            between trees in the form of black rhizomorphs (&ldquo;shoestrings&rdquo;).
          </p>

          <p className="text-[13px] leading-[1.7] text-gray-800 mb-3" data-testid="wiki-size">
            A specimen in northeastern Oregon&rsquo;s{" "}
            <span className="text-blue-700">Malheur National Forest</span> is possibly the{" "}
            <b>largest living organism on Earth</b> by mass, area, and volume; it covers{" "}
            <b>3.5&nbsp;square&nbsp;miles</b> (9.1&nbsp;km²) and weighs as much as{" "}
            <b>35,000&nbsp;tons</b>. It is estimated to be some <b>8,000&nbsp;years&nbsp;old</b>.
          </p>

          {/* Description section */}
          <h2
            className="text-[17px] font-serif border-b border-gray-200 pb-0.5 mt-5 mb-2"
            data-testid="wiki-section-description"
          >
            Description
          </h2>
          <p className="text-[13px] leading-[1.7] text-gray-800 mb-3">
            The species grows and spreads primarily underground, such that the bulk of the organism
            is not visible from the surface. In the autumn, the subterranean parts of the organism
            bloom &ldquo;honey mushrooms&rdquo; as surface fruits. Low competition for land and
            nutrients often allow this fungus to grow to huge proportions.
          </p>

          {/* Pathogenicity section */}
          <h2
            className="text-[17px] font-serif border-b border-gray-200 pb-0.5 mt-5 mb-2"
            data-testid="wiki-section-pathogenicity"
          >
            Pathogenicity
          </h2>
          <p className="text-[13px] leading-[1.7] text-gray-800 mb-3">
            This species is of particular interest to forest managers, as it is highly pathogenic
            to a number of commercial softwoods, notably Douglas-fir, true firs, pine trees, and
            Western Hemlock. The fungus is able to remain viable in stumps for 50&nbsp;years.
          </p>
          <p className="text-[13px] leading-[1.7] text-gray-800 mb-3">
            Pathogenicity of the fungus is seen to differ among trees of varying age and location.
            Younger conifer trees at age 10 and below are more susceptible to infection, while more
            mature trees have an increased chance of survival.
          </p>

          {/* Distribution section */}
          <h2
            className="text-[17px] font-serif border-b border-gray-200 pb-0.5 mt-5 mb-2"
            data-testid="wiki-section-distribution"
          >
            Distribution and habitat
          </h2>
          <p className="text-[13px] leading-[1.7] text-gray-800 mb-3">
            <i>Armillaria ostoyae</i> is mostly common in the cooler regions of the northern
            hemisphere. In North America, this fungus is found on host coniferous trees in the
            forests of British Columbia and the Pacific Northwest.
          </p>
          <p className="text-[13px] leading-[1.7] text-gray-800 mb-6">
            A mushroom colony in the Malheur National Forest in the Strawberry Mountains of eastern
            Oregon was found to be the largest fungal colony in the world, spanning an area of
            3.5&nbsp;square miles (2,200&nbsp;acres; 9.1&nbsp;km²). If considered a single
            organism, it is one of the largest known organisms in the world by area.
          </p>
        </div>
      </div>
    </div>
  );
}
