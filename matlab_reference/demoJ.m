%% Archivo con simulaciones para el número de coordinación
clear all; clc;
% Preparamos las variables de entrada
% Diameter of primary particles
dop = 25;
% Sintering coefficient
delta = 1.0;
% Method
method = 'TuningPC';
% Prefactor and fractal dimension
minkf = 1.5;
pasokf = 0.1;
maxkf = 2.5;
minDf = 1.25;
pasoDf = 0.1;
maxDf = 2.75;
kf = minkf:pasokf:maxkf;
Df = minDf:pasoDf:maxDf;
npo = randi( [ 20, 300 ], 100, 1 );
sim = allcomb( npo, kf, Df );

% Number of simulations
numSim = size( sim, 1 );
% Directory where agglomerates will reside
timestamp = datestr( datetime( 'now' ) );
timestamp = strrep( timestamp, ':', '' );
timestamp = strrep( timestamp, '-', '' );
timestamp = strrep( timestamp, ' ', '_' );
% simDir = 'Simulaciones';
% agloName = 'Agglo_';
% ImDir = [ simDir '_' timestamp ];
% % Prepare output directories
% if ~exist( ImDir, 'dir' )
%    mkdir( ImDir );
% end

formatSpec = '%03.0f';
formatSpec2 = '%02.0f';
NofPart     = sim( :, 1 );
RadiusOfGir = zeros( numSim, 1 );
J           = zeros( numSim, 3 );
tAgglo      = zeros( numSim, 1 );
tImage      = zeros( numSim, 1 );
intentos    = zeros( numSim, 1 );

%% Create pool if none exists

for nsim = 1 : numSim
    fprintf([ 'Simulación ', num2str(nsim), ' de un total de ', num2str(numSim), '\n' ] );
    tic;
    [ aglomerado, ref, trials ] = TuningPC( sim( nsim, 1 ), 25, delta, sim( nsim, 2), sim( nsim, 3 ), 2, 25 );
    tAgglo( nsim, 1 ) = toc;
    
    % Calculamos el cdg y el rg
    cG = calculateCentreOfGravity( aglomerado );
    RadiusOfGir( nsim, 1 ) = calculateRadiusOfGyration( aglomerado, 1, cG );
    vecinas = full( sum( determinarVecindad( aglomerado ), 2 ) );
    J( nsim, 1 ) = sum( vecinas );
    J( nsim, 2 ) = max( vecinas );
    J( nsim, 3 ) = mean( vecinas );    
end

%% Save data to Excel
nombre = [ 'Simulation_', timestamp, '.xlsx' ];
Variables = { 'npo', 'kf', 'Df', 'rg', 'Jtotal', 'Jmax', 'Jmean', 'tAgglo' };
Table = array2table( [ sim, RadiusOfGir, J, tAgglo ], 'VariableNames', Variables );
% Save as xlsx file
writetable( Table, nombre );
