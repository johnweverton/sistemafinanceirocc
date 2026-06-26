import type { SVGProps } from 'react';

/**
 * Logo Carmem Cavalcante como SVG inline.
 * Sem fundo branco — funciona em qualquer cor de fundo.
 * viewBox recortado ao conteudo real da marca.
 */
export function LogoCC(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="330 808 1360 450"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Carmem Cavalcante Contabilidade"
      role="img"
      style={{ fillRule: 'evenodd', clipRule: 'evenodd' }}
      {...props}
    >
      {/* Simbolo */}
      <g id="cc-mark">
        <path
          d="M543.776,835.303c-20.332,2.882 -55.873,13.928 -55.873,17.29c0,0.64 5.123,1.921 11.527,3.042c52.511,9.125 99.259,43.866 123.914,92.375c6.564,12.808 6.564,12.808 65.479,13.288c36.502,0.16 59.556,-0.16 60.516,-1.121c2.241,-2.241 -10.887,-28.977 -21.613,-44.507c-17.29,-24.975 -49.79,-52.191 -76.846,-64.359c-33.3,-14.889 -73.804,-20.973 -107.104,-16.01Z"
          fill="#01254c"
          fillRule="nonzero"
        />
        <path
          d="M395.687,945.129c-12.487,29.137 -16.65,49.47 -16.65,80.528c0,27.376 3.682,48.029 12.648,70.442c6.084,15.209 6.084,15.209 63.238,15.689c31.379,0.16 56.994,-0.32 56.994,-0.961c0,-0.8 -1.921,-3.042 -4.162,-5.283c-6.884,-6.404 -19.051,-25.775 -24.495,-39.063c-8.005,-19.212 -10.566,-35.381 -8.325,-51.871c3.202,-22.894 14.729,-47.709 30.258,-65.639c3.682,-4.483 6.724,-8.325 6.724,-8.805c0,-0.48 -25.615,-0.961 -56.834,-0.961c-56.834,0 -56.834,0 -59.396,5.924Z"
          fill="#01254c"
          fillRule="nonzero"
        />
        <path
          d="M629.267,1091.617c-0.64,1.121 -3.522,6.724 -6.244,12.487c-22.413,46.108 -71.723,82.77 -122.794,91.415c-6.724,1.121 -12.327,2.562 -12.327,3.202c0,2.081 25.295,11.047 40.664,14.729c11.367,2.562 20.172,3.362 40.184,3.362c33.62,0.16 52.992,-3.842 82.449,-16.97c26.736,-12.007 59.396,-39.223 76.526,-64.038c9.766,-14.409 23.534,-41.945 21.933,-44.347c-1.601,-2.722 -118.631,-2.401 -120.392,0.16Z"
          fill="#01254c"
          fillRule="nonzero"
        />
      </g>

      {/* Texto */}
      <g
        id="cc-text"
        transform="matrix(2.373786,0,0,2.373786,-2299.425237,-1495.957318)"
        style={{ fontFamily: "'CodecColdTrial-Bold','Codec Cold Trial','Barlow Condensed',sans-serif" }}
      >
        <text
          x="1331.212"
          y="1043.943"
          fontWeight="700"
          fontSize="50"
          fill="#01254c"
        >
          COBRAN&#xC7;A
        </text>
        <text
          x="1331.212"
          y="1085.609"
          fontWeight="700"
          fontSize="50"
          fill="#01254c"
        >
          CARMEM
        </text>
        <text
          x="1331.212"
          y="1127.276"
          fontWeight="900"
          fontSize="50"
          fill="#01254c"
        >
          CAVALCANTE
        </text>
      </g>
    </svg>
  );
}
