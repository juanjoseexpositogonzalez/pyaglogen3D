function criba = hacerCriba( impactante, impactado, vec, delta )

% ----------------------------------------------------------------------------------------------------------------------
% criba = hacerCriba( impactante, impactado, punto, vec )
% Realiza una criba entre los monomeros que componen los clusteres del impactante y del
% impactado. Para ello compara las distancias entre los centros de los monómeros con la suma de los radios de
% los monómeros
%
% Argumentos de entrada:
% impactante:       Clúster impactante (monomeros)
% impactado:        Clúster impactado (monomeros)
% punto:            Punto por el cual pasa la trayectoria de impacto
% vec:              Vector unitario que define la trayectoria
% delta:            Coeficiente de sintering o aplastamiento
%
% Argumentos de salida:
% criba:            Celda con los índices de los monómeros de ambos clústeres candidatos a
%                   colisionar entre sí.
% ----------------------------------------------------------------------------------------------------------------------
% Vemos si no hemos introducido un valor para delta
if isempty( delta )
    delta = 1;
end

% Reservamos espacio para la variable de salida
criba = cell( size( impactante, 1 ), 2 );
% disCentros almacena la distancia entre el monómero m impactante y el n impactado en una matriz de mxn
disCentros = zeros( size( impactante, 1 ), size( impactado, 1 ) );
% Variable que va a almacenar la suma de los radios para comparar con disCentros
sumaRadios = disCentros;
% Eliminamos el numero de cluster dentro de la estructura general ya que esta información ya se
% tiene de antes y queremos saber cual o cualles monomeros dentro de cada clúster van a 
% solaparse a priori
impactante = impactante( :, 2 : end );
impactado  = impactado( :, 2 : end );

% Ahora debemos calcular las distancias mínimas entre los centros de los monómeros de los dos clústeres 
for m = 1 : size( impactante, 1 )   % Recorremos los monómeros del impactante
    for n = 1 : size( impactado, 1 )    % Recorremos los monómeros del impactado
        disCentros( impactante( m, 1 ), impactado( n, 1 ) ) = ...
            distanciaPuntoLinea( impactante( m, 2 : 4 ), impactado( n, 2 : 4 ), vec );
    end
end

% Convertimos a matriz diagonal superior la suma de los radios ajustando por el coeficiente de
% sintering si procede
for m = 1 : size( impactante, 1 )
    for n = 1 : size( impactado, 1 )
        sumaRadios( impactante( m, 1 ), impactado( n, 1 ) ) = ( impactante( m, 5 ) + impactado( n, 5 ) ) / delta;
    end
end

%% Realizamos la criba como tal
% Restamos los elementos de disCentros y sumaRadios y vemos cuáles son menores a cero. Las filas representan
% los monómeros correspondientes al clúster impactante y las columnas los monómeros del impactado
[ filas, columnas ] = find( disCentros - sumaRadios <= 0 );
uniFilas = 1 : 1 : max( filas );
    
% Rellenamos la estuctura criba con la información de filas y columnas
for m = 1 : numel( uniFilas )
    criba{ m, 1 } = uniFilas( m );
    % Extraemos los elementos de columnas que tienen la misma fila
    idx = filas == m;
    elementos = columnas( idx );
    criba{ m, 2 } = reshape( elementos, 1, numel( elementos ) );
end

% Borramos los elementos vacíos de criba, almacenamos primero las filas a eliminar para evitar errores de
% desbordamiento
criba = corregirCriba( criba );

end

function d = distanciaPuntoLinea( cluster, iP, v )
% -----------------------------------------------------------------------------------------------------------------
% d = distanciaPuntoLinea( part, i, iP, v )
% Determina la minima distancia desde los centros geometricos de las particulas de un
% cluster a un punto
% 
% Argumentos de entrada:
% cluster:  Celda con las matrices de los clusteres.
% iP:       Punto perteneciente a la recta a la cual se quiere determinar la distancia
% v:        Vector que determina la direccion de la recta
%
% Argumentos de salida:
% d:        Distancia minima punto-linea
%
% -----------------------------------------------------------------------------------------------------------------
    d = zeros( size( cluster, 1 ) );
    for n = 1 : size( d, 1 )
        AP = iP - cluster( 1 : 3 );
        AP = cross( AP, v );
        d( n, 1 ) = ( norm( AP ) / norm( v ) );
    end

end

function criba = corregirCriba( criba )

eliminar = [];
for m = 1 : size( criba, 1 )
    if isempty( criba{ m, 2 } )
        eliminar = [ eliminar m ]; %#ok<AGROW>
    end
end

% Eliminamos los elementos vacios

criba( eliminar, : ) = [];

end