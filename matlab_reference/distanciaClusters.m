function gamma = distanciaClusters( npo1, npo2, dpo, constante, kf, Df )
    npo = ( npo1 + npo2 );
    gamma1 = npo ^ 2 / ( npo1 * npo2 ) * dpo ^ 2 / 4 * ...
        ( ( npo / kf ) ^ ( 2 / Df ) - constante );
        gamma2 = npo / npo2 * ( ( npo1 / kf ) ^ ( 2 / Df )  - constante );
        gamma3 = npo / npo1 * ( ( npo2 / kf ) ^ ( 2 / Df ) - constante );
        gamma = sqrt( gamma1 - gamma2 - gamma3 );
end