%% Variable definition area
% Number of primary particles in the agglomerate
nop = { 200, 90, 'normal' };
% Diameter of primary particles
dop = 25;
% Sintering coefficient
delta = 1.1;
% Method
method = 'CC';
% Number of maximum agglomerates to create
maxAgglom = 10;
% Directory where agglomerates will reside
timestamp = datestr( datetime( 'now' ) );
timestamp = strrep( timestamp, ':', '' );
timestamp = strrep( timestamp, '-', '' );
timestamp = strrep( timestamp, ' ', '_' );
simDir = 'Simulaciones';
imDir = [ 'Images_' maxAgglom 'agglo_' method '_delta' num2str( delta ) '_' ];
imDir = strrep( imDir, ' ', '' );
ImDir = [ imDir timestamp ];
% Prepare output directories
if ~exist( simDir, 'dir' )
    mkdir( simDir );
    chdir( simDir ); 
    mkdir( ImDir );
    chdir ../..   
else
    chdir( simDir );
    
    mkdir( ImDir );
    chdir ..
end

NofPart     = zeros( 1, maxAgglom );
RadiusOfGir = zeros( 1, maxAgglom );
maxJ        = zeros( 1, maxAgglom );
tAgglo      = zeros( 1, maxAgglom );
tImage      = zeros( 1, maxAgglom );
intentos    = zeros( 1, maxAgglom );
part        = [];
vec         = {};
escala      = {};

% Create pool if none exists
poolobj = gcp( 'nocreate' );

parfor i = 1 : maxAgglom
    tic;
    [ p, r, intents, v, deltas ]     = agloGen3D( nop, dop, delta, method );
    part                             = [ part; p ];   %#ok<*AGROW>
    intentos( 1, i )                 = intents;
    vec{ i }                         = v;    
    tAgglo( 1, i )                   = toc;
    NofPart( 1, i )                  = size( p, 1 );
    RadiusOfGir( 1, i )              = r{ 1 }{ 2 }( end, end );
    maxJ( 1, i )                     = max( sum( v , 2 ) );
    eS                               = r{ 1 }{ 2 }( 1, : );
    [ h, e ]                         = saveAgglomerate( p, eS, i, [ simDir '/' ImDir ] );
    tic;
    escal                            = create2DImages( p, i, [ simDir '/' ImDir ] );
    escala                           = [ escala; escal ]; 
    tImage( 1, i )                   = toc;
end

clearvars -except NofPart maxJ RadiusOfGir tImage part vec pixelsize escala
% Multiply by 25 to get number of pixels per 25 nm
escala( :, 3 ) = cellfun( @( x ) x * 25, escala( :, 2 ), 'un', 0 );
% Write scale to csv file
Encabezados = { 'Nombre Proyeccion', 'Escala (pixels/nm)', 'Escala (pixels/25 nm)' };
scales = [ 'Escalas_' timestamp '.csv' ];
fid = fopen( [ simDir '/' scales ], 'w' );
fprintf( fid, '%s, %s, %s\n', Encabezados{ 1, : } );
for n = 1 : size( escala, 1 )
    fprintf( fid, '%s, %3.4f, %3.4f\n', escala{ n, : } );
end
fclose( fid );
save( [ simDir '/' sprintf( timestamp ) '.mat' ] );
clear fid
% Close parpool
delete( poolobj );