clear; clc;
%% Variable definition area
% Number of primary particles in the agglomerate
nop = { 200, 90, 'normal' };
% Diameter of primary particles
dop = 25;
% Sintering coefficient
delta = 1;
% Method
method = 'TuningPC';
% Number of maximum agglomerates to create
maxAgglom = 1;
% kf and Df
minkf = 1.5;
pasokf = 0.25;
maxkf = 3;
minDf = 1.25;
pasoDf = 0.25;
maxDf = 2.75;
kf = minkf:pasokf:maxkf;
Df = minDf:pasoDf:maxDf;
kfDf = allcomb( kf, Df );
% kffixed = 1.75;
% Dffixed = 1.5;
% kf1Df = kfDf( kfDf( :, 1 ) == kffixed, : );
% kfDf1 = kfDf( kfDf( :, 2 ) == Dffixed, : );
% kfDf = [ kf1Df; kfDf1 ];
% kfDf = unique( kfDf, 'rows' );
% Number of simulations
numSim = size( kfDf, 1 ) * maxAgglom;
% Directory where agglomerates will reside
timestamp = datestr( datetime( 'now' ) );
timestamp = strrep( timestamp, ':', '' );
timestamp = strrep( timestamp, '-', '' );
timestamp = strrep( timestamp, ' ', '_' );
simDir = 'Simulaciones';
% imDir = [ 'Images_' num2str( maxAgglom ) 'Agglo_' method '_delta' num2str( delta ) '_' ];
agloName = 'Agglo_';
% imDir = strrep( imDir, ' ', '' );
ImDir = [ simDir '_' timestamp ];
%directorio = cell( numSim, 1 );
% Prepare output directories
if ~exist( ImDir, 'dir' )
   mkdir( ImDir );
end
% if ~exist( simDir, 'dir' )
%     mkdir( simDir );
%     chdir( simDir ); 
%     mkdir( ImDir );
%     chdir( ImDir );
%     for ss = 1 : numSim
%         directorio{ ss, 1 } = [ 'kf' num2str( kfDf( ss, 1 ) ) 'Df' num2str( kfDf( ss, 2 ) ) ];
%         mkdir( directorio{ ss, 1 } );
%     end
%     chdir ../../..   
% else
%     chdir( simDir );    
%     mkdir( ImDir );
%     chdir( ImDir );
%     for ss = 1 : numSim
%         directorio{ ss, 1 } = [ 'kf' num2str( kfDf( ss, 1 ) ) 'Df' num2str( kfDf( ss, 2 ) ) ];
%         mkdir( directorio{ ss, 1 } );
%     end
%     chdir ../..
% end

formatSpec = '%03.0f';
formatSpec2 = '%02.0f';
NofPart     = zeros( numSim, maxAgglom );
RadiusOfGir = zeros( numSim, maxAgglom );
maxJ        = zeros( numSim, maxAgglom );
tAgglo      = zeros( numSim, maxAgglom );
tImage      = zeros( numSim, maxAgglom );
intentos    = zeros( numSim, maxAgglom );
part        = [];
vec         = {};
escala      = {};

gpuArray


%% Create pool if none exists
poolobj = gcp( 'nocreate' );

kf = kfDf( :, 1 );
Df = kfDf( :, 2 );

%% Simulation
for j = 1 : size( kfDf, 1 )
%     kf = kfDf( j, 1 );
%     Df = kfDf( j, 2 );
    %dir = directorio{ j, 1 };
    for i = 1 : maxAgglom
        tic;
        [ p, r, intents, v, ~, ~, ~, ~, ~ ] = kfDfAgglo3D( nop, dop, delta, kf( j ), Df( j ), 'PC' );
        part                                = [ part; p ];   %#ok<*AGROW>
        intentos( j, i )                    = intents;
        vec{ j, i }                         = v;     
        tAgglo( j, i )                      = toc;
        NofPart( j, i )                     = size( p, 1 );
        RadiusOfGir( j, i )                 = r{ 1 }{ 2 }( end, end );
        maxJ( j, i )                        = max( sum( v , 2 ) );
        eS                                  = r{ 1 }{ 2 }( 1, : );
%         [ h, e ]                            = saveAgglomerate( p, eS, i, [ simDir '/' ImDir dir ] );
        aGloName                            = [ agloName sprintf( formatSpec, ( j - 1 ) * maxAgglom + i ), ...
                                                '_npo_' sprintf( formatSpec, size( p, 1 ) ) ...
                                                '_Df' sprintf( formatSpec2, Df( j ) * 100 ) ...
                                                '_kf' sprintf( formatSpec2, kf( j ) * 100 ) ];
        [ h, e ]                            = saveAgglomerate( p, eS, i, ImDir, aGloName );
        p                                   = cell2mat( p );
        p                                   = p( :, 3 : end );
        tic;
        escal                               = create2DImages( p, i, ImDir, aGloName );
        escala                              = [ escala; escal ]; 
        tImage( j, i )                      = toc;
    end
end

%% Cleanup
clearvars -except NofPart maxJ RadiusOfGir tImage part vec pixelsize escala timestamp ImDir simDir

%% Remove empty cells in escala
escala = escala( ~cellfun( 'isempty', escala ) );
% Count how many cell text are in the set
textCellnum = sum( ~cellnum( @isnumeric, escala ) );
escala = reshape( escala, size( escala, 1 ) / 2, 2 );
% Multiply by 25 to get number of pixels per 25 nm
escala( :, 3 ) = cellfun( @( x ) x * 25, escala( :, 2 ), 'un', 0 );

%% Write scale to csv file
Encabezados = { 'Nombre Proyeccion', 'Escala (pixels/nm)', 'Escala (pixels/25 nm)' };
scales = [ 'Escalas_' timestamp '.csv' ];
fid = fopen( [ ImDir '/' scales ], 'w' );
fprintf( fid, '%s, %s, %s\n', Encabezados{ 1, : } );
for n = 1 : size( escala, 1 )
    fprintf( fid, '%s, %3.4f, %3.4f\n', escala{ n, : } );
end
fclose( fid );
save( [ ImDir '/' 'Simulaciones_' sprintf( timestamp ) '.mat' ] );
clearvars

%% Close parpool
delete( poolobj );