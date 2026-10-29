maxAgglom   = size( NofPart, 2 );
tDf         = zeros( 1, maxAgglom );
Df          = zeros( 1, maxAgglom );
kf          = zeros( 1, maxAgglom );
nb = 32;
M = 1;
eRange = [ 18 30 ];
% Df
for i = 1 : maxAgglom
    tic;
    % Calculamos la Df
    file                             = [ 'Agglomerado_' method '_num_' num2str( i ) '_' ...
                                         num2str( NofPart( i ) ) '_Particles' ];
    min                              = 1 + sum( NofPart( 1 : i - 1 ) );
    max                              = sum( NofPart( 1 : i ) );
    p                                = part( min : max, : );
    crearArchivoDat( p, 0, file );
    [ np, s, qv]                     = box_count( [ file '.dat' ], nb, M );
    [ x, np, fitresult ]             = fit_frac( np, s ,eRange);
    coeficientes                     = coeffvalues( fitresult );
    Df( 1, i )                       = -coeficientes( 1 );
    kf( 1, i )                       = coeficientes( 2 );
    tDf( 1, i )                      = toc;
end